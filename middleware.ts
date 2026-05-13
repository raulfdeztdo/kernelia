import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Match all pathnames except those that start with:
  // - /api, /_next, /_vercel
  // - static files (with a file extension)
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
