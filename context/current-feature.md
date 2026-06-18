# Current Feature

## Status
In Progress

## Goals
- Ensure outbound emails always go to the user's primary email, except credential email verification.
- Update primary email change UI dialog with warnings and conditional paid subscription notices.
- Explicitly log `customer.updated` Stripe webhook events on the backend.

## Notes
- Intercept and redirect target email addresses in `sendEmail` utility, querying the database for a matching user.
- Pass `isPro` status to the profile page settings component.
- Ensure all tests pass.
