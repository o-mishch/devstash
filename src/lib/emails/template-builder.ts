import baseTemplateHtml from './base-template.html'

export function buildEmailTemplate(title: string, bodyHtml: string): string {
  return baseTemplateHtml
    .replace('{{TITLE}}', title)
    .replace('{{BODY}}', bodyHtml)
}
