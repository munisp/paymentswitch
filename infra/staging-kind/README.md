# Staging Kind Provisioning

This directory provisions a clean Ubuntu staging host contract for the payment-switch regression environment. Terraform is intentionally provider-neutral: attach `cloud-init.yaml` to the approved Ubuntu VM provider’s `user_data` or `custom_data` field, pass an SSH public key, and apply the module. The cloud-init script installs Docker, kubectl, Kind, and Helm, creates the `paymentswitch-staging` Kind cluster, and installs External Secrets Operator, cert-manager, and metrics-server.

## Terraform

```bash
terraform -chdir=infra/staging-kind init
terraform -chdir=infra/staging-kind plan \
  -var='ssh_public_key=ssh-ed25519 AAAA...' \
  -var='host_name=paymentswitch-staging-kind'
```

The module does not create a VM because no cloud provider was selected. It emits a bootstrap contract and a cloud-init path so the organization can bind it to the approved cloud provider without embedding provider credentials in this repository.

## Host requirements

The host must be Ubuntu 22.04 or later with outbound HTTPS access and sufficient CPU, memory, disk, and nested-container support. The cloud-init script installs Docker and runs Kind using Docker as its provider. In production-like staging, use a dedicated VM and restrict SSH and Kubernetes API access to the release-engineering network.

## Operators installed

The bootstrap installs External Secrets Operator for secret synchronization, cert-manager for certificate lifecycle, and metrics-server for resource metrics. The chart versions and Kind version are explicit in the bootstrap; review and update them through normal dependency change control.

## Regression execution

After bootstrap, configure the staging secret backend and apply the repository overlay:

```bash
kubectl apply -k deploy/k8s/staging
kubectl wait --for=condition=complete job/web-portal-migration -n paymentswitch-staging --timeout=10m
kubectl rollout status deployment/web-portal -n paymentswitch-staging --timeout=10m
```

Run the project checks from a trusted runner with staging endpoints and a short-lived Keycloak token. Do not treat Kind as proof of production capacity, HA behavior, or managed-cluster policy enforcement.
