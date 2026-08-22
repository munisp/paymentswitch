terraform {
  required_version = ">= 1.6.0"

  required_providers {
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
}

variable "ssh_public_key" {
  type        = string
  description = "SSH public key installed on the staging host."
}

variable "host_name" {
  type        = string
  default     = "paymentswitch-staging-kind"
  description = "Cloud/VM hostname to provision."
}

variable "cloud_init_path" {
  type        = string
  default     = "${path.module}/cloud-init.yaml"
  description = "Cloud-init file used by the selected VM provider."
}

variable "external_secrets_chart_version" {
  type        = string
  default     = "0.19.2"
  description = "Pinned External Secrets Operator chart version. Override after reviewing the current approved chart."
}

variable "cert_manager_chart_version" {
  type        = string
  default     = "v1.17.2"
  description = "Pinned cert-manager chart version. Override after reviewing the current approved chart."
}

output "cloud_init_path" {
  value = var.cloud_init_path
}

output "bootstrap_command" {
  value = "sudo cloud-init status --wait && kubectl config get-contexts"
}

# This module is provider-neutral by design. Attach var.cloud_init_path to the
# user_data/custom_data field of an Ubuntu VM in the approved cloud provider.
# The null resource provides a local, auditable rendering/checkpoint and does
# not pretend to create a VM without a selected infrastructure provider.
resource "null_resource" "staging_kind_bootstrap_contract" {
  triggers = {
    host_name                       = var.host_name
    cloud_init_sha256               = filesha256(var.cloud_init_path)
    ssh_public_key_sha256           = sha256(var.ssh_public_key)
    external_secrets_chart_version = var.external_secrets_chart_version
    cert_manager_chart_version     = var.cert_manager_chart_version
  }

  provisioner "local-exec" {
    command = "echo staging-kind bootstrap contract rendered for ${self.triggers.host_name}"
  }
}
