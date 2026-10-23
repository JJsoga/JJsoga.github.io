/** Site identity is separate from the person and page-specific titles. */
export const siteBrand = {
  name: 'JJsoga',
  alternateName: 'Hexin Chen',
  url: 'https://jjsoga.github.io/',
} as const;

export const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${siteBrand.url}#website`,
  ...siteBrand,
};
