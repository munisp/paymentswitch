#!/usr/bin/env python3
"""
Email Verification and Document Upload Service
"""

import os
import secrets
import hashlib
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

from flask import Flask, request, jsonify
import psycopg2
import psycopg2.extras
import redis

app = Flask(__name__)

# Redis configuration for storing verification tokens
redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST", "localhost"),
    port=int(os.getenv("REDIS_PORT", "6379")),
    db=int(os.getenv("REDIS_DB", "0")),
    decode_responses=True
)

# Database configuration (PostgreSQL)
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", "5432")),
    "user": os.getenv("DB_USER", "payment_user"),
    "password": os.getenv("DB_PASSWORD", ""),
    "dbname": os.getenv("DB_NAME", "payment_switch"),
}


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint"""
    return jsonify({"status": "healthy", "service": "email-verification"})


@app.route("/send-verification", methods=["POST"])
def send_verification():
    """Send email verification link"""
    data = request.json
    
    email = data.get("email")
    user_id = data.get("user_id")
    merchant_id = data.get("merchant_id")
    
    if not email:
        return jsonify({"error": "email is required"}), 400
    
    try:
        # Generate verification token
        token = generate_verification_token()
        
        # Store token in Redis with 24 hour expiry
        token_data = {
            "email": email,
            "user_id": user_id,
            "merchant_id": merchant_id,
            "created_at": datetime.now().isoformat()
        }
        
        redis_client.setex(
            f"verify:{token}",
            timedelta(hours=24),
            str(token_data)
        )
        
        # Generate verification URL
        base_url = os.getenv("APP_URL", "https://payment-switch.com")
        verification_url = f"{base_url}/verify-email?token={token}"
        
        # Send verification email
        send_verification_email(email, verification_url)
        
        return jsonify({
            "success": True,
            "token": token,
            "expires_at": (datetime.now() + timedelta(hours=24)).isoformat()
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/verify", methods=["POST"])
def verify_email():
    """Verify email with token"""
    data = request.json
    
    token = data.get("token")
    
    if not token:
        return jsonify({"error": "token is required"}), 400
    
    try:
        # Get token data from Redis
        token_key = f"verify:{token}"
        token_data = redis_client.get(token_key)
        
        if not token_data:
            return jsonify({"error": "Invalid or expired token"}), 400
        
        # Parse token data
        import json
        token_info = json.loads(token_data if isinstance(token_data, str) else token_data.decode('utf-8'))
        
        email = token_info.get("email")
        user_id = token_info.get("user_id")
        merchant_id = token_info.get("merchant_id")
        
        # Mark email as verified in database
        mark_email_verified(email, user_id, merchant_id)
        
        # Delete token from Redis
        redis_client.delete(token_key)
        
        return jsonify({
            "success": True,
            "email": email,
            "verified_at": datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/resend-verification", methods=["POST"])
def resend_verification():
    """Resend verification email"""
    data = request.json
    
    email = data.get("email")
    
    if not email:
        return jsonify({"error": "email is required"}), 400
    
    try:
        # Check if email already verified
        if is_email_verified(email):
            return jsonify({"error": "Email already verified"}), 400
        
        # Generate new token
        token = generate_verification_token()
        
        # Store token
        token_data = {
            "email": email,
            "created_at": datetime.now().isoformat()
        }
        
        redis_client.setex(
            f"verify:{token}",
            timedelta(hours=24),
            str(token_data)
        )
        
        # Send email
        base_url = os.getenv("APP_URL", "https://payment-switch.com")
        verification_url = f"{base_url}/verify-email?token={token}"
        send_verification_email(email, verification_url)
        
        return jsonify({
            "success": True,
            "message": "Verification email resent"
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload-document", methods=["POST"])
def upload_document():
    """Upload KYC document"""
    
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    
    file = request.files["file"]
    document_type = request.form.get("document_type", "other")
    merchant_id = request.form.get("merchant_id")
    
    if not merchant_id:
        return jsonify({"error": "merchant_id is required"}), 400
    
    try:
        # Generate unique filename
        file_ext = file.filename.rsplit(".", 1)[1] if "." in file.filename else "pdf"
        filename = f"{merchant_id}_{document_type}_{secrets.token_hex(8)}.{file_ext}"
        
        # Save file (in production, upload to S3)
        upload_dir = "/tmp/uploads"
        os.makedirs(upload_dir, exist_ok=True)
        file_path = os.path.join(upload_dir, filename)
        file.save(file_path)
        
        # Generate file URL (in production, S3 URL)
        file_url = f"https://cdn.payment-switch.com/documents/{filename}"
        
        # Store document metadata in database
        document_id = store_document_metadata(
            merchant_id=merchant_id,
            document_type=document_type,
            filename=filename,
            file_url=file_url,
            file_size=os.path.getsize(file_path)
        )
        
        return jsonify({
            "success": True,
            "document_id": document_id,
            "file_url": file_url,
            "filename": filename
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/documents", methods=["GET"])
def get_documents():
    """Get uploaded documents for merchant"""
    merchant_id = request.args.get("merchant_id")
    
    if not merchant_id:
        return jsonify({"error": "merchant_id is required"}), 400
    
    try:
        documents = get_merchant_documents(merchant_id)
        return jsonify({"documents": documents})
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def generate_verification_token() -> str:
    """Generate secure verification token"""
    return secrets.token_urlsafe(32)


def send_verification_email(email: str, verification_url: str):
    """Send verification email via configured email provider"""
    import logging
    import requests
    
    logger = logging.getLogger(__name__)
    
    # Get email provider configuration from environment
    email_provider = os.getenv("EMAIL_PROVIDER", "sendgrid")  # sendgrid, ses, smtp
    
    subject = "Verify Your Email - Payment Switch"
    html_content = f"""
    <html>
    <body>
        <h2>Email Verification</h2>
        <p>Please click the link below to verify your email address:</p>
        <p><a href="{verification_url}">Verify Email</a></p>
        <p>Or copy and paste this URL into your browser:</p>
        <p>{verification_url}</p>
        <p>This link will expire in 24 hours.</p>
        <p>If you did not request this verification, please ignore this email.</p>
    </body>
    </html>
    """
    
    try:
        if email_provider == "sendgrid":
            # SendGrid API integration
            sendgrid_api_key = os.getenv("SENDGRID_API_KEY")
            if not sendgrid_api_key:
                logger.warning("SENDGRID_API_KEY not configured, email not sent")
                return
            
            response = requests.post(
                "https://api.sendgrid.com/v3/mail/send",
                headers={
                    "Authorization": f"Bearer {sendgrid_api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "personalizations": [{"to": [{"email": email}]}],
                    "from": {"email": os.getenv("EMAIL_FROM", "noreply@payment-switch.com")},
                    "subject": subject,
                    "content": [{"type": "text/html", "value": html_content}]
                },
                timeout=30
            )
            response.raise_for_status()
            logger.info(f"Verification email sent to {email} via SendGrid")
            
        elif email_provider == "ses":
            # AWS SES integration
            import boto3
            
            ses_client = boto3.client(
                'ses',
                region_name=os.getenv("AWS_REGION", "us-east-1")
            )
            
            ses_client.send_email(
                Source=os.getenv("EMAIL_FROM", "noreply@payment-switch.com"),
                Destination={"ToAddresses": [email]},
                Message={
                    "Subject": {"Data": subject},
                    "Body": {"Html": {"Data": html_content}}
                }
            )
            logger.info(f"Verification email sent to {email} via AWS SES")
            
        elif email_provider == "smtp":
            # SMTP integration
            import smtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart
            
            smtp_host = os.getenv("SMTP_HOST", "localhost")
            smtp_port = int(os.getenv("SMTP_PORT", "587"))
            smtp_user = os.getenv("SMTP_USER", "")
            smtp_password = os.getenv("SMTP_PASSWORD", "")
            
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = os.getenv("EMAIL_FROM", "noreply@payment-switch.com")
            msg["To"] = email
            msg.attach(MIMEText(html_content, "html"))
            
            with smtplib.SMTP(smtp_host, smtp_port) as server:
                if smtp_user and smtp_password:
                    server.starttls()
                    server.login(smtp_user, smtp_password)
                server.sendmail(msg["From"], [email], msg.as_string())
            
            logger.info(f"Verification email sent to {email} via SMTP")
        
        else:
            logger.warning(f"Unknown email provider: {email_provider}, email not sent")
            
    except Exception as e:
        logger.error(f"Failed to send verification email to {email}: {e}")
        raise


def mark_email_verified(email: str, user_id: Optional[int], merchant_id: Optional[int]):
    """Mark email as verified in database"""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()
        
        if user_id:
            query = "UPDATE users SET email_verified = 1 WHERE id = %s"
            cursor.execute(query, (user_id,))
        
        if merchant_id:
            query = "UPDATE merchants SET email_verified = 1 WHERE id = %s"
            cursor.execute(query, (merchant_id,))
        
        conn.commit()
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"Database error: {e}")
        raise


def is_email_verified(email: str) -> bool:
    """Check if email is already verified"""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()
        
        query = """
            SELECT email_verified FROM users WHERE email = %s
            UNION
            SELECT email_verified FROM merchants WHERE email = %s
        """
        cursor.execute(query, (email, email))
        result = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        return result and result[0] == 1
        
    except Exception as e:
        print(f"Database error: {e}")
        return False


def store_document_metadata(merchant_id: int, document_type: str, filename: str, 
                            file_url: str, file_size: int) -> int:
    """Store document metadata in database"""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()
        
        query = """
            INSERT INTO kyc_documents 
            (merchant_id, document_type, filename, file_url, file_size, uploaded_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
        """
        
        cursor.execute(query, (
            merchant_id,
            document_type,
            filename,
            file_url,
            file_size,
            datetime.now()
        ))
        
        document_id = cursor.fetchone()[0]
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return document_id
        
    except Exception as e:
        print(f"Database error: {e}")
        raise


def get_merchant_documents(merchant_id: int) -> list:
    """Get all documents for a merchant"""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        query = """
            SELECT 
                id,
                document_type,
                filename,
                file_url,
                file_size,
                uploaded_at,
                verified
            FROM kyc_documents
            WHERE merchant_id = %s
            ORDER BY uploaded_at DESC
        """
        
        cursor.execute(query, (merchant_id,))
        documents = cursor.fetchall()
        
        cursor.close()
        conn.close()
        
        return documents
        
    except Exception as e:
        print(f"Database error: {e}")
        return []


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8005"))
    app.run(host="0.0.0.0", port=port, debug=True)
