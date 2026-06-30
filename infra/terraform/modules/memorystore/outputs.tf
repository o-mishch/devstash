output "host" {
  value = google_redis_instance.cache.host
}

output "port" {
  value = google_redis_instance.cache.port
}

output "auth_string" {
  value     = google_redis_instance.cache.auth_string
  sensitive = true
}

# Google-managed server CA (PEM) for the SERVER_AUTHENTICATION TLS connection. The
# app passes it to ioredis as REDIS_CA_CERT to verify Memorystore's cert (rediss://).
# RedisInsight / redis-cli also use it (--cacert) to connect from a bastion/pod.
output "server_ca_cert" {
  value     = google_redis_instance.cache.server_ca_certs[0].cert
  sensitive = true
}
