import { getRequestConfig } from "next-intl/server";
import { isLocale, routing } from "./routing";

// Static-literal imports so the bundler can split each locale into
// its own chunk and tree-shake the unused one out of the SSR bundle.
// `import(`../messages/${locale}.json`)` would force the bundler to
// keep every locale together at every site that references this
// module.
const LOADERS = {
  es: () => import("../messages/es.json"),
  en: () => import("../messages/en.json"),
} as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await LOADERS[locale]()).default,
  };
});
