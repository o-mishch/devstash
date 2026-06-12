import { SYSTEM_TYPE_ORDER } from './constants'

function pluralize(name: string): string {
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) return name.slice(0, -1) + 'ies'
  if (name.endsWith('s') || name.endsWith('ch') || name.endsWith('sh') || name.endsWith('x') || name.endsWith('z')) return name + 'es'
  return name + 's'
}

export function getTypeLabel(name: string): string {
  if (!name) return ''
  const plural = pluralize(name)
  return plural.charAt(0).toUpperCase() + plural.slice(1)
}

export function getTypePlural(name: string): string {
  return name ? pluralize(name) : ''
}

export function slugToTypeName(slug: string): string {
  return SYSTEM_TYPE_ORDER.find(t => getTypePlural(t) === slug) ?? slug
}
