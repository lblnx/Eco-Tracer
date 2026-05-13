variable "cloudflare_api_token" {
  description = "Token de API de Cloudflare"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "ID de la cuenta de Cloudflare"
  type        = string
}