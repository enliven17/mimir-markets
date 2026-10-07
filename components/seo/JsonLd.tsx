/** Structured data for search engines (lib/seo.ts builds it). `<` is escaped so the JSON can never close the tag. */
export default function JsonLd({ data }: { data: object | object[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
