import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Match all pathnames except:
  // - /api, /_next, /_vercel
  // - /admin/* — admin backoffice has its own auth surface, no locale segment
  // - static files (with a file extension)
  matcher: ["/((?!api|admin|_next|_vercel|.*\\..*).*)"],
};
