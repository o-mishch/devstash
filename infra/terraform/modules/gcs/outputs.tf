output "bucket_name" {
  value = google_storage_bucket.uploads.name
}

output "bucket_url" {
  value = google_storage_bucket.uploads.url
}
