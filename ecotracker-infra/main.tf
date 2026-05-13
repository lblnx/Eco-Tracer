# Creación de la base de datos relacional Serverless (D1)
resource "cloudflare_d1_database" "ecotracker_db" {
  account_id = var.cloudflare_account_id
  name       = "ecotracker-db"
}