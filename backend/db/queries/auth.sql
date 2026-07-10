-- name: GetUserByID :one
-- Resolve the session's user. id comes from the session cookie, never user input.
SELECT * FROM users WHERE id = $1;

-- name: GetUserByEmail :one
-- Credentials login / account lookup by email.
SELECT * FROM users WHERE email = $1;
