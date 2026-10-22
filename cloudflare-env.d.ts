declare const __SITE_REVISION__: string;

declare namespace Cloudflare {
  interface Env {
    SITE_REVISION?: string;
    DB?: D1Database;
    HOSTED_JOBS_TOKEN?: string;
    BUCKET?: R2Bucket;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GOOGLE_TOKEN_ENCRYPTION_KEY?: string;
    SUBTITLE_BACKEND_URL?: string;
    SUBTITLE_BACKEND_TOKEN?: string;
  }
}
