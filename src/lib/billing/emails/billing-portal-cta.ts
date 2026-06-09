/** Shared portal CTA block for billing notification emails. */
export function billingPortalCtaHtml(portalUrl: string): string {
  return `<p>
  <a href="${portalUrl}" style="display:inline-block;padding:12px 20px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
    Update billing details
  </a>
</p>
<p>If the button doesn&apos;t work, open this link:</p>
<p><a href="${portalUrl}">${portalUrl}</a></p>`
}
