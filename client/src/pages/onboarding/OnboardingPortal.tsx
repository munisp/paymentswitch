import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Building2,
  CreditCard,
  Globe,
  Shield,
  Server,
  Upload,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
} from "lucide-react";
import { createLogger } from "@/lib/logger";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";

const log = createLogger("OnboardingPortal");

function mapServerValidationErrors(error: any): Record<string, string> {
  const mapped: Record<string, string> = {};
  const zodError = error?.data?.zodError ?? error?.shape?.data?.zodError;
  const fieldErrors = zodError?.fieldErrors ?? {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (Array.isArray(messages) && typeof messages[0] === "string")
      mapped[field] = messages[0];
  }
  for (const issue of zodError?.issues ?? error?.issues ?? []) {
    const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
    if (path && !mapped[path] && typeof issue.message === "string")
      mapped[path] = issue.message;
  }
  return mapped;
}

const stakeholderTypes = [
  {
    id: "BANK",
    name: "Bank",
    icon: Building2,
    description: "Commercial or central bank",
  },
  {
    id: "MOBILE_MONEY_OPERATOR",
    name: "Mobile Money Operator",
    icon: CreditCard,
    description: "Mobile money service provider",
  },
  {
    id: "FINTECH",
    name: "Fintech",
    icon: Globe,
    description: "Financial technology company",
  },
  {
    id: "MICROFINANCE_INSTITUTION",
    name: "Microfinance Institution",
    icon: Building2,
    description: "Microfinance or credit union",
  },
  {
    id: "GOVERNMENT_AGENCY",
    name: "Government Agency",
    icon: Shield,
    description: "Government or regulatory body",
  },
  {
    id: "MERCHANT",
    name: "Merchant",
    icon: CreditCard,
    description: "Business accepting payments",
  },
  {
    id: "REGULATOR",
    name: "Regulator",
    icon: Shield,
    description: "Financial regulator",
  },
  {
    id: "NOC_OPERATOR",
    name: "NOC Operator",
    icon: Server,
    description: "Network operations center",
  },
  {
    id: "DEVELOPER",
    name: "Developer",
    icon: Server,
    description: "API developer or integrator",
  },
];

const countries = [
  "Nigeria",
  "Kenya",
  "Ghana",
  "South Africa",
  "Tanzania",
  "Uganda",
  "Rwanda",
  "Ethiopia",
  "Senegal",
  "Ivory Coast",
];

const requiredDocuments: Record<string, string[]> = {
  BANK: [
    "Certificate of Incorporation",
    "Banking License",
    "AML/CFT Policy",
    "Board Resolution",
    "Financial Statements (3 years)",
    "IT Security Assessment",
  ],
  MOBILE_MONEY_OPERATOR: [
    "Certificate of Incorporation",
    "Mobile Money License",
    "AML/CFT Policy",
    "Board Resolution",
    "Financial Statements (2 years)",
  ],
  FINTECH: [
    "Certificate of Incorporation",
    "Operating License",
    "AML/CFT Policy",
    "Financial Statements (2 years)",
    "Data Protection Policy",
  ],
  MICROFINANCE_INSTITUTION: [
    "Certificate of Incorporation",
    "MFI License",
    "AML/CFT Policy",
    "Financial Statements (2 years)",
  ],
  GOVERNMENT_AGENCY: [
    "Authorization Letter",
    "Government ID",
    "Data Protection Policy",
  ],
  MERCHANT: [
    "Business Registration",
    "Tax Certificate",
    "Bank Statement (6 months)",
  ],
  REGULATOR: ["Authorization Letter", "Government ID"],
  NOC_OPERATOR: [
    "Certificate of Incorporation",
    "Service Agreement",
    "Security Clearance",
  ],
  DEVELOPER: ["Business Registration", "API Use Case Document"],
};

interface FormData {
  organizationName: string;
  stakeholderType: string;
  registrationNumber: string;
  taxId: string;
  country: string;
  address: string;
  website: string;
  description: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactTitle: string;
  apiEndpoint: string;
  callbackUrl: string;
  ipWhitelist: string;
  preferredEnvironment: "sandbox" | "staging" | "production";
}

const steps = [
  { number: 1, title: "Organization", description: "Basic information" },
  { number: 2, title: "Contact", description: "Primary contact" },
  { number: 3, title: "Documents", description: "Required documents" },
  { number: 4, title: "Technical", description: "API configuration" },
  { number: 5, title: "Review", description: "Submit application" },
];

export default function OnboardingPortal() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  type DocumentManifestEntry = {
    name: string;
    key: string;
    url: string;
    size: number;
    contentType: string;
    uploadedAt: string;
  };
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [documentManifest, setDocumentManifest] = useState<
    DocumentManifestEntry[]
  >([]);
  const [draftVersion, setDraftVersion] = useState<number | undefined>();
  const [pendingDocumentLabel, setPendingDocumentLabel] = useState<
    string | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<FormData>({
    organizationName: "",
    stakeholderType: "",
    registrationNumber: "",
    taxId: "",
    country: "",
    address: "",
    website: "",
    description: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    contactTitle: "",
    apiEndpoint: "",
    callbackUrl: "",
    ipWhitelist: "",
    preferredEnvironment: "sandbox",
  });

  const draftQuery = trpc.technicalOnboarding.getDraft.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const saveDraft = trpc.technicalOnboarding.saveDraft.useMutation({
    onSuccess: draft => setDraftVersion(draft.version),
    onError: error => log.error(`Draft save failed: ${error.message}`),
  });
  const initiateMultipartUpload =
    trpc.technicalOnboarding.initiateMultipartUpload.useMutation();
  const presignMultipartPart =
    trpc.technicalOnboarding.presignMultipartPart.useMutation();
  const completeMultipartUpload =
    trpc.technicalOnboarding.completeMultipartUpload.useMutation();
  const abortMultipartUpload =
    trpc.technicalOnboarding.abortMultipartUpload.useMutation();

  const recordUploadedDocument = (document: DocumentManifestEntry) => {
    const nextManifest = [...documentManifest, document];
    setDocumentManifest(nextManifest);
    setUploadedFiles(previous => [...previous, document.name]);
    if (isAuthenticated) {
      saveDraft.mutate({
        currentStep,
        formData: { ...formData },
        documentManifest: nextManifest,
        version: draftVersion,
      });
    }
  };

  const uploadDocument = trpc.technicalOnboarding.uploadDocument.useMutation({
    onSuccess: document => {
      recordUploadedDocument(document);
      toast.success(`${document.name} uploaded securely`);
    },
    onError: error => toast.error(error.message || "Document upload failed"),
  });

  useEffect(() => {
    const draft = draftQuery.data;
    if (!draft) return;
    setCurrentStep(draft.currentStep);
    setFormData(previous => ({
      ...previous,
      ...(draft.formData as Partial<FormData>),
    }));
    const manifest = (draft.documentManifest as DocumentManifestEntry[]) ?? [];
    setDocumentManifest(manifest);
    setUploadedFiles(manifest.map(document => document.name));
    setDraftVersion(draft.version);
  }, [draftQuery.data]);

  const persistDraft = (step = currentStep) => {
    if (!isAuthenticated || saveDraft.isPending) return;
    saveDraft.mutate({
      currentStep: step,
      formData: { ...formData },
      documentManifest,
      version: draftVersion,
    });
  };

  const uploadLargeDocument = async (file: File, documentLabel: string) => {
    let upload:
      | { uploadId: string; key: string; partSize: number; partCount: number }
      | undefined;
    try {
      upload = await initiateMultipartUpload.mutateAsync({
        documentLabel,
        fileName: file.name,
        contentType: file.type as
          | "application/pdf"
          | "image/png"
          | "image/jpeg",
        size: file.size,
      });
      const parts: Array<{ partNumber: number; etag: string }> = [];
      for (
        let partNumber = 1;
        partNumber <= upload.partCount;
        partNumber += 1
      ) {
        const start = (partNumber - 1) * upload.partSize;
        const end = Math.min(start + upload.partSize, file.size);
        const presigned = await presignMultipartPart.mutateAsync({
          uploadId: upload.uploadId,
          key: upload.key,
          partNumber,
        });
        const response = await fetch(presigned.url, {
          method: "PUT",
          body: file.slice(start, end),
        });
        if (!response.ok)
          throw new Error(
            `Part ${partNumber} upload failed (${response.status})`
          );
        const etag =
          response.headers.get("ETag") ?? response.headers.get("etag");
        if (!etag)
          throw new Error(
            `Part ${partNumber} response did not include an ETag`
          );
        parts.push({ partNumber, etag: etag.replaceAll('"', "") });
      }
      const completed = await completeMultipartUpload.mutateAsync({
        uploadId: upload.uploadId,
        key: upload.key,
        documentLabel,
        originalFileName: file.name,
        contentType: file.type as
          | "application/pdf"
          | "image/png"
          | "image/jpeg",
        size: file.size,
        parts,
      });
      recordUploadedDocument(completed);
      toast.success(`${documentLabel} uploaded securely`);
    } catch (error) {
      if (upload)
        await abortMultipartUpload
          .mutateAsync({ uploadId: upload.uploadId, key: upload.key })
          .catch(() => undefined);
      throw error;
    }
  };

  const handleFileSelected = (file: File, documentLabel: string) => {
    const allowedTypes = ["application/pdf", "image/png", "image/jpeg"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Only PDF, PNG, and JPEG documents are accepted.");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      toast.error("Documents must be 500 MB or smaller.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setIsSubmitting(true);
      uploadLargeDocument(file, documentLabel)
        .catch(error =>
          toast.error(
            error instanceof Error ? error.message : "Multipart upload failed"
          )
        )
        .finally(() => setIsSubmitting(false));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const base64 = result.includes(",")
        ? result.slice(result.indexOf(",") + 1)
        : result;
      uploadDocument.mutate({
        documentLabel,
        fileName: file.name,
        contentType: file.type as
          | "application/pdf"
          | "image/png"
          | "image/jpeg",
        size: file.size,
        base64,
      });
    };
    reader.onerror = () =>
      toast.error("The selected document could not be read.");
    reader.readAsDataURL(file);
  };

  const submitApplication =
    trpc.technicalOnboarding.createParticipantApplication.useMutation({
      onSuccess: data => {
        setCaseId(data.reference);
        setIsSubmitted(true);
        setCurrentStep(5);
        setIsSubmitting(false);
        toast.success("Application submitted successfully");
      },
      onError: err => {
        log.error(String(err));
        setErrors(previous => ({
          ...previous,
          ...mapServerValidationErrors(err),
        }));
        setIsSubmitting(false);
        toast.error(
          err.message ||
            "Failed to submit application. Please correct the highlighted fields."
        );
      },
    });

  const updateField = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};

    if (step === 1) {
      if (!formData.organizationName)
        newErrors.organizationName = "Organization name is required";
      if (!formData.stakeholderType)
        newErrors.stakeholderType = "Please select a stakeholder type";
      if (!formData.registrationNumber)
        newErrors.registrationNumber = "Registration number is required";
      if (!formData.country) newErrors.country = "Country is required";
      if (!formData.address) newErrors.address = "Address is required";
    }

    if (step === 2) {
      if (!formData.contactName)
        newErrors.contactName = "Contact name is required";
      if (!formData.contactEmail)
        newErrors.contactEmail = "Contact email is required";
      if (
        formData.contactEmail &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contactEmail)
      ) {
        newErrors.contactEmail = "Please enter a valid email address";
      }
      if (!formData.contactPhone)
        newErrors.contactPhone = "Contact phone is required";
      if (!formData.contactTitle)
        newErrors.contactTitle = "Contact title is required";
    }

    if (step === 4) {
      if (!formData.apiEndpoint)
        newErrors.apiEndpoint = "API endpoint is required";
      if (
        formData.apiEndpoint &&
        !formData.apiEndpoint.startsWith("https://")
      ) {
        newErrors.apiEndpoint = "API endpoint must use HTTPS";
      }
      if (!formData.callbackUrl)
        newErrors.callbackUrl = "Callback URL is required";
      if (
        formData.callbackUrl &&
        !formData.callbackUrl.startsWith("https://")
      ) {
        newErrors.callbackUrl = "Callback URL must use HTTPS";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      const nextStep = Math.min(currentStep + 1, 5);
      setCurrentStep(nextStep);
      persistDraft(nextStep);
    }
  };

  const handleBack = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  const handleSubmit = () => {
    if (!isAuthenticated) {
      toast.error(
        "Please sign in before submitting an onboarding application."
      );
      window.location.href = getLoginUrl();
      return;
    }
    if (!validateStep(4)) return;
    setIsSubmitting(true);
    submitApplication.mutate({
      formData: { ...formData },
      documentManifest,
    });
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="pt-8 pb-8 text-center">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Application Submitted</h2>
              <p className="text-gray-600 mb-6">
                Your application has been submitted successfully. Our team will
                review your application and contact you within 3-5 business
                days.
              </p>
              <div className="bg-gray-50 rounded-lg p-4 mb-6 border">
                <p className="text-sm text-gray-500">Application Reference</p>
                <p className="text-lg font-mono font-bold text-gray-900">
                  {caseId}
                </p>
              </div>
              <div className="space-y-3">
                <h3 className="font-semibold text-left">What happens next?</h3>
                <div className="text-left space-y-2 text-sm text-gray-600">
                  <div className="flex gap-2">
                    <span className="font-medium text-blue-600">1.</span>{" "}
                    KYB/KYC verification of your organization and key personnel
                  </div>
                  <div className="flex gap-2">
                    <span className="font-medium text-blue-600">2.</span>{" "}
                    Technical review of your API endpoints and security
                    configuration
                  </div>
                  <div className="flex gap-2">
                    <span className="font-medium text-blue-600">3.</span>{" "}
                    Sandbox environment provisioning for integration testing
                  </div>
                  <div className="flex gap-2">
                    <span className="font-medium text-blue-600">4.</span>{" "}
                    Certification testing and go-live approval
                  </div>
                </div>
              </div>
              <div className="mt-6 flex gap-3 justify-center">
                <Button variant="outline" onClick={() => navigate("/")}>
                  Back to Home
                </Button>
                <Button onClick={() => navigate("/onboarding/integration")}>
                  Start Integration
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold mb-2">
            Join the Payment Switch Network
          </h1>
          <p className="text-gray-600">
            Complete your application to become a participant in Nigeria's
            payment switch infrastructure
          </p>
        </div>

        {/* Step Indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {steps.map((step, idx) => (
              <div key={step.number} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors ${
                      currentStep > step.number
                        ? "bg-green-600 border-green-600 text-white"
                        : currentStep === step.number
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "bg-white border-gray-300 text-gray-500"
                    }`}
                  >
                    {currentStep > step.number ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      step.number
                    )}
                  </div>
                  <div className="mt-1 text-xs font-medium text-gray-600">
                    {step.title}
                  </div>
                </div>
                {idx < steps.length - 1 && (
                  <div
                    className={`w-16 sm:w-24 h-0.5 mx-2 ${currentStep > step.number ? "bg-green-600" : "bg-gray-300"}`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <Card>
          <CardHeader>
            <CardTitle>{steps[currentStep - 1].title}</CardTitle>
            <CardDescription>
              {steps[currentStep - 1].description}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {currentStep === 1 && (
              <div className="space-y-6">
                {/* Stakeholder type selection */}
                <div>
                  <Label className="text-sm font-semibold mb-3 block">
                    Stakeholder Type *
                  </Label>
                  <div className="grid grid-cols-3 gap-3">
                    {stakeholderTypes.map(
                      ({ id, name, icon: Icon, description }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => updateField("stakeholderType", id)}
                          className={`p-4 rounded-lg border-2 text-left transition-colors ${
                            formData.stakeholderType === id
                              ? "border-blue-600 bg-blue-50"
                              : "border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <Icon className="h-5 w-5 mb-2 text-gray-600" />
                          <div className="font-medium text-sm">{name}</div>
                          <div className="text-xs text-gray-500">
                            {description}
                          </div>
                        </button>
                      )
                    )}
                  </div>
                  {errors.stakeholderType && (
                    <p className="text-sm text-red-600 mt-1">
                      {errors.stakeholderType}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="orgName">Organization Name *</Label>
                    <Input
                      id="orgName"
                      value={formData.organizationName}
                      onChange={e =>
                        updateField("organizationName", e.target.value)
                      }
                    />
                    {errors.organizationName && (
                      <p className="text-sm text-red-600 mt-1">
                        {errors.organizationName}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="regNum">Registration Number *</Label>
                    <Input
                      id="regNum"
                      value={formData.registrationNumber}
                      onChange={e =>
                        updateField("registrationNumber", e.target.value)
                      }
                      placeholder="RC-123456"
                    />
                    {errors.registrationNumber && (
                      <p className="text-sm text-red-600 mt-1">
                        {errors.registrationNumber}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="taxId">Tax ID</Label>
                    <Input
                      id="taxId"
                      value={formData.taxId}
                      onChange={e => updateField("taxId", e.target.value)}
                      placeholder="TIN-12345678"
                    />
                  </div>
                  <div>
                    <Label htmlFor="country">Country *</Label>
                    <Select
                      value={formData.country}
                      onValueChange={v => updateField("country", v)}
                    >
                      <SelectTrigger id="country">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {countries.map(c => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.country && (
                      <p className="text-sm text-red-600 mt-1">
                        {errors.country}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <Label htmlFor="address">Registered Address *</Label>
                  <Textarea
                    id="address"
                    value={formData.address}
                    onChange={e => updateField("address", e.target.value)}
                    rows={2}
                  />
                  {errors.address && (
                    <p className="text-sm text-red-600 mt-1">
                      {errors.address}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="website">Website</Label>
                    <Input
                      id="website"
                      value={formData.website}
                      onChange={e => updateField("website", e.target.value)}
                      placeholder="https://example.com"
                    />
                  </div>
                  <div>
                    <Label htmlFor="desc">Business Description</Label>
                    <Input
                      id="desc"
                      value={formData.description}
                      onChange={e => updateField("description", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="cName">Full Name *</Label>
                    <Input
                      id="cName"
                      value={formData.contactName}
                      onChange={e => updateField("contactName", e.target.value)}
                    />
                    {errors.contactName && (
                      <p className="text-sm text-red-600 mt-1">
                        {errors.contactName}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="cTitle">Job Title *</Label>
                    <Input
                      id="cTitle"
                      value={formData.contactTitle}
                      onChange={e =>
                        updateField("contactTitle", e.target.value)
                      }
                      placeholder="CTO, VP Engineering, etc."
                    />
                    {errors.contactTitle && (
                      <p className="text-sm text-red-600 mt-1">
                        {errors.contactTitle}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="cEmail">Email Address *</Label>
                    <Input
                      id="cEmail"
                      type="email"
                      value={formData.contactEmail}
                      onChange={e =>
                        updateField("contactEmail", e.target.value)
                      }
                    />
                    {errors.contactEmail && (
                      <p className="text-sm text-red-600 mt-1">
                        {errors.contactEmail}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="cPhone">Phone Number *</Label>
                    <Input
                      id="cPhone"
                      value={formData.contactPhone}
                      onChange={e =>
                        updateField("contactPhone", e.target.value)
                      }
                      placeholder="+234 xxx xxx xxxx"
                    />
                    {errors.contactPhone && (
                      <p className="text-sm text-red-600 mt-1">
                        {errors.contactPhone}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-6">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (file && pendingDocumentLabel)
                      handleFileSelected(file, pendingDocumentLabel);
                    event.currentTarget.value = "";
                  }}
                />
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-amber-800">
                      Required Documents
                    </p>
                    <p className="text-sm text-amber-700">
                      Please upload the following documents for{" "}
                      {formData.stakeholderType
                        ? stakeholderTypes.find(
                            s => s.id === formData.stakeholderType
                          )?.name
                        : "your organization type"}
                      .
                    </p>
                  </div>
                </div>

                {formData.stakeholderType && (
                  <div className="space-y-3">
                    {(requiredDocuments[formData.stakeholderType] ?? []).map(
                      (doc, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3 bg-white border rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <FileText className="h-5 w-5 text-gray-400" />
                            <div>
                              <p className="font-medium text-sm">{doc}</p>
                              <p className="text-xs text-gray-500">
                                PDF, PNG, or JPG (max 10MB)
                              </p>
                            </div>
                          </div>
                          {uploadedFiles.includes(doc) ? (
                            <span className="text-green-600 flex items-center gap-1 text-sm">
                              <CheckCircle2 className="h-4 w-4" /> Uploaded
                            </span>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setPendingDocumentLabel(doc);
                                fileInputRef.current?.click();
                              }}
                            >
                              <Upload className="h-4 w-4 mr-1" /> Upload
                            </Button>
                          )}
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            )}

            {currentStep === 4 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="apiEndpoint">API Endpoint *</Label>
                    <Input
                      id="apiEndpoint"
                      value={formData.apiEndpoint}
                      onChange={e => updateField("apiEndpoint", e.target.value)}
                      placeholder="https://api.example.com/v1"
                    />
                    {errors.apiEndpoint && (
                      <p className="text-sm text-red-600 mt-1">
                        {errors.apiEndpoint}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="callbackUrl">Callback URL *</Label>
                    <Input
                      id="callbackUrl"
                      value={formData.callbackUrl}
                      onChange={e => updateField("callbackUrl", e.target.value)}
                      placeholder="https://api.example.com/callback"
                    />
                    {errors.callbackUrl && (
                      <p className="text-sm text-red-600 mt-1">
                        {errors.callbackUrl}
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <Label htmlFor="ipWhitelist">
                    IP Whitelist (comma-separated)
                  </Label>
                  <Input
                    id="ipWhitelist"
                    value={formData.ipWhitelist}
                    onChange={e => updateField("ipWhitelist", e.target.value)}
                    placeholder="192.168.1.1, 10.0.0.0/24"
                  />
                </div>
                <div>
                  <Label htmlFor="env">Preferred Environment</Label>
                  <Select
                    value={formData.preferredEnvironment}
                    onValueChange={v => updateField("preferredEnvironment", v)}
                  >
                    <SelectTrigger id="env">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sandbox">Sandbox</SelectItem>
                      <SelectItem value="staging">Staging</SelectItem>
                      <SelectItem value="production">Production</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {currentStep === 5 && (
              <div className="space-y-6">
                <h3 className="font-semibold">Review Your Application</h3>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-gray-500 uppercase">
                      Organization
                    </h4>
                    <div className="text-sm">
                      <span className="text-gray-500">Name:</span>{" "}
                      {formData.organizationName}
                    </div>
                    <div className="text-sm">
                      <span className="text-gray-500">Type:</span>{" "}
                      {
                        stakeholderTypes.find(
                          s => s.id === formData.stakeholderType
                        )?.name
                      }
                    </div>
                    <div className="text-sm">
                      <span className="text-gray-500">Reg #:</span>{" "}
                      {formData.registrationNumber}
                    </div>
                    <div className="text-sm">
                      <span className="text-gray-500">Country:</span>{" "}
                      {formData.country}
                    </div>
                    <div className="text-sm">
                      <span className="text-gray-500">Address:</span>{" "}
                      {formData.address}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-gray-500 uppercase">
                      Primary Contact
                    </h4>
                    <div className="text-sm">
                      <span className="text-gray-500">Name:</span>{" "}
                      {formData.contactName}
                    </div>
                    <div className="text-sm">
                      <span className="text-gray-500">Title:</span>{" "}
                      {formData.contactTitle}
                    </div>
                    <div className="text-sm">
                      <span className="text-gray-500">Email:</span>{" "}
                      {formData.contactEmail}
                    </div>
                    <div className="text-sm">
                      <span className="text-gray-500">Phone:</span>{" "}
                      {formData.contactPhone}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-gray-500 uppercase">
                      Technical
                    </h4>
                    <div className="text-sm">
                      <span className="text-gray-500">API:</span>{" "}
                      {formData.apiEndpoint}
                    </div>
                    <div className="text-sm">
                      <span className="text-gray-500">Callback:</span>{" "}
                      {formData.callbackUrl}
                    </div>
                    <div className="text-sm">
                      <span className="text-gray-500">Environment:</span>{" "}
                      {formData.preferredEnvironment}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-gray-500 uppercase">
                      Documents
                    </h4>
                    <div className="text-sm">
                      {uploadedFiles.length} document(s) uploaded
                    </div>
                    {uploadedFiles.map((f, i) => (
                      <div key={i} className="text-sm flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-600" /> {f}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between mt-8 pt-4 border-t">
              {currentStep > 1 ? (
                <Button variant="outline" onClick={handleBack}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back
                </Button>
              ) : (
                <Button variant="outline" onClick={() => navigate("/")}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Home
                </Button>
              )}

              {currentStep < 5 ? (
                <Button onClick={handleNext}>
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button onClick={handleSubmit} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />{" "}
                      Submitting...
                    </>
                  ) : (
                    "Submit Application"
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
