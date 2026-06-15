# File Upload with AWS S3

## Overview

Add file and image upload functionality using AWS S3 storage.

## Requirements

- Create upload API route for S3
- Stick to lib/db/items.ts for prisma/db functions
- Create FileUpload component with drag-and-drop
- Update create item modal to use FileUpload for file/image types
- Delete files from S3 when items are deleted
- Create download proxy API route (avoids CORS issues)
- Add download button in ItemDrawer for file types
- Show upload progress indicator
- Display image preview for images, file info for files

## File Constraints

| Type   | Max Size | Extensions                                            |
| ------ | -------- | ----------------------------------------------------- |
| Images | 5 MB     | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`      |
| Files  | 10 MB    | `.pdf`, `.txt`, `.md`, `.json`, `.yaml`, `.yml`, `.xml`, `.csv`, `.toml`, `.ini` |

## MIME Types

**Images:**
- `image/png`
- `image/jpeg`
- `image/gif`
- `image/webp`
- `image/svg+xml`

**Files:**
- `application/pdf`
- `text/plain`
- `text/markdown`
- `application/json`
- `application/x-yaml`, `text/yaml`
- `application/xml`, `text/xml`
- `text/csv`
- `application/toml`
- `text/plain` (for `.ini`)
