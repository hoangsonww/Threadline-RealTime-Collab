const swaggerUiCss = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css";
const swaggerUiBundle = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js";
const redocBundle = "https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js";
const favicon = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f9f5.svg";

const csp = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "worker-src 'self' blob:",
  "img-src 'self' data: https://cdn.jsdelivr.net https://cdn.redoc.ly",
  "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
  "connect-src 'self'",
].join("; ");

function shell(title: string, body: string, extraHead = "") {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#0b1020" />
    <meta name="description" content="Threadline API documentation" />
    <link rel="icon" type="image/svg+xml" href="${favicon}" />
    <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&amp;family=Manrope:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet" />
    <title>${title}</title>
    ${extraHead}
    <style>
      :root {
        color-scheme: dark;
        font-family: "Manrope", ui-sans-serif, system-ui, sans-serif;
        background: #08101e;
        color: #edf4ff;
        --docs-bg: #08101e;
        --docs-surface: #0d1829;
        --docs-surface-raised: #122037;
        --docs-border: #253753;
        --docs-border-strong: #385277;
        --docs-text: #edf4ff;
        --docs-text-secondary: #b6c5da;
        --docs-text-muted: #8fa2bc;
        --docs-accent: #71a7ff;
        --docs-accent-strong: #91bbff;
        --docs-code: #9fc2ff;
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        min-width: 320px;
        background:
          radial-gradient(circle at 18% -10%, rgba(59, 115, 194, .14), transparent 32rem),
          linear-gradient(180deg, #091221 0%, var(--docs-bg) 28rem);
        color: var(--docs-text);
      }
      ::selection { background: rgba(113, 167, 255, .3); color: #fff; }
      .skip-link { position: fixed; top: .75rem; left: .75rem; z-index: 100; transform: translateY(-160%); padding: .65rem .85rem; border-radius: .5rem; background: #fff; color: #08101e; font-weight: 800; text-decoration: none; transition: transform .18s ease; }
      .skip-link:focus { transform: translateY(0); }
      .docs-topbar { position: sticky; top: 0; z-index: 40; display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; min-height: 68px; padding: 0 clamp(1rem, 4vw, 4.5rem); border-bottom: 1px solid rgba(143, 162, 188, .2); background: rgba(8, 16, 30, .86); box-shadow: 0 12px 32px rgba(1, 7, 17, .18); backdrop-filter: blur(18px) saturate(130%); }
      .brand { display: inline-flex; align-items: center; gap: .72rem; color: #f7faff; font-weight: 800; letter-spacing: -.04em; text-decoration: none; font-size: 1.05rem; white-space: nowrap; }
      .brand-mark { display: grid; place-items: center; width: 30px; height: 30px; border: 1px solid #4772a9; border-radius: 8px; background: #12233b; box-shadow: inset 0 1px 0 rgba(255,255,255,.08); color: var(--docs-accent-strong); font-family: "IBM Plex Mono", monospace; font-size: .86rem; }
      .brand small { color: var(--docs-text-muted); font-weight: 600; letter-spacing: -.01em; font-size: .76rem; }
      .docs-nav { display: flex; align-items: center; gap: .4rem; }
      .docs-nav a { color: var(--docs-text-secondary); border: 1px solid transparent; border-radius: .5rem; padding: .5rem .72rem; text-decoration: none; font-size: .78rem; font-weight: 700; transition: background-color .18s ease, border-color .18s ease, color .18s ease, transform .18s ease; }
      .docs-nav a:hover { color: #fff; background: #14233a; border-color: #2c4263; transform: translateY(-1px); }
      .docs-nav a:active { transform: translateY(0); }
      .docs-nav a[aria-current="page"] { color: #fff; background: #192b46; border-color: #3b567d; box-shadow: inset 0 1px 0 rgba(255,255,255,.06); }
      .brand:focus-visible, .docs-nav a:focus-visible { outline: 3px solid rgba(113,167,255,.48); outline-offset: 3px; }
      .docs-footer { max-width: 1280px; margin: 0 auto; padding: 1.5rem clamp(1rem, 4vw, 3rem) 2.5rem; color: var(--docs-text-muted); font-size: .78rem; line-height: 1.6; }
      @media (max-width: 720px) { .docs-topbar { align-items: flex-start; flex-direction: column; gap: .55rem; padding-top: .7rem; padding-bottom: .7rem; } .docs-nav { width: 100%; overflow-x: auto; padding-bottom: .15rem; scrollbar-width: none; } .docs-nav::-webkit-scrollbar { display: none; } .docs-nav a { flex: 0 0 auto; } }
    </style>
  </head>
  <body><a class="skip-link" href="#main-content">Skip to API reference</a>${body}</body>
</html>`;
}

export const apiDocsCsp = csp;

export function renderSwaggerDocs() {
  return shell(
    "Threadline API Reference",
    `<header class="docs-topbar">
      <a class="brand" href="/api-docs" aria-label="Threadline API documentation home"><span class="brand-mark">↝</span><span>threadline <small>API reference</small></span></a>
      <nav class="docs-nav" aria-label="Documentation views"><a href="/api-docs" aria-current="page">Swagger UI</a><a href="/api-docs/redoc">ReDoc</a><a href="/openapi.json">OpenAPI JSON</a><a href="/health">Health</a></nav>
    </header>
    <main id="main-content"><div id="swagger-ui" aria-label="Threadline API reference"></div></main>
    <footer class="docs-footer">Interactive API reference · Browser sessions use secure HttpOnly cookies · Automation uses scoped personal access tokens</footer>
    <script src="${swaggerUiBundle}" defer></script>
    <script>
      window.addEventListener("DOMContentLoaded", function () {
        window.ui = SwaggerUIBundle({
          url: "/openapi.json",
          dom_id: "#swagger-ui",
          deepLinking: true,
          displayRequestDuration: true,
          filter: true,
          persistAuthorization: false,
          tryItOutEnabled: true,
          requestInterceptor: function (request) { request.credentials = "same-origin"; return request; },
          presets: [SwaggerUIBundle.presets.apis],
          layout: "BaseLayout",
        });
      });
    </script>`,
    `<link rel="stylesheet" href="${swaggerUiCss}" />
     <style>
       .swagger-ui { max-width: 1340px; margin: 0 auto; padding: 2rem clamp(1rem, 4vw, 3rem) 3rem; color: var(--docs-text); }
       .swagger-ui .wrapper { max-width: 1280px; padding: 0; }
       .swagger-ui, .swagger-ui .info .title, .swagger-ui .opblock-tag, .swagger-ui .opblock .opblock-summary-description, .swagger-ui .btn, .swagger-ui input, .swagger-ui select, .swagger-ui textarea { font-family: "Manrope", ui-sans-serif, system-ui, sans-serif; }
       .swagger-ui code, .swagger-ui pre, .swagger-ui .opblock-summary-path, .swagger-ui .parameter__type, .swagger-ui .prop-type, .swagger-ui .prop-format { font-family: "IBM Plex Mono", ui-monospace, monospace; }
       .swagger-ui .topbar { display: none; }
       .swagger-ui .info { margin: .8rem 0 2.25rem; max-width: 74rem; }
       .swagger-ui .info .title { margin: 0 0 .85rem; color: #f7faff; font-size: clamp(2rem, 4vw, 3.35rem); font-weight: 800; letter-spacing: -.055em; line-height: 1.02; text-wrap: balance; }
       .swagger-ui .info .title small { top: -.15rem; margin-left: .65rem; border-radius: .35rem; background: #315f9a; vertical-align: middle; }
       .swagger-ui .info .title small pre { color: #f7faff; font-family: "IBM Plex Mono", monospace; font-weight: 600; }
       .swagger-ui .info .description, .swagger-ui .info .description .renderedMarkdown { max-width: 76ch; margin-right: 0; margin-left: 0; }
       .swagger-ui .info .renderedMarkdown p { margin-right: 0; margin-left: 0; }
       .swagger-ui .info p, .swagger-ui .info li { max-width: 76ch; color: var(--docs-text-secondary); font-size: .92rem; font-weight: 500; line-height: 1.68; }
       .swagger-ui .info a, .swagger-ui .link, .swagger-ui .markdown a { color: var(--docs-accent-strong); font-weight: 700; text-decoration-color: rgba(145,187,255,.45); text-underline-offset: .18em; }
       .swagger-ui .info a:hover, .swagger-ui .link:hover, .swagger-ui .markdown a:hover { color: #c4d9ff; }
       .swagger-ui .markdown code, .swagger-ui .renderedMarkdown code { border: 1px solid #2c4569; border-radius: .32rem; background: #101e33; padding: .12rem .3rem; color: #b9d2ff; font-size: .88em; }

       .swagger-ui .scheme-container { margin: 0 0 2rem; padding: 1.2rem 1.3rem; background: rgba(13,24,41,.92); box-shadow: 0 20px 50px rgba(1,7,17,.2), inset 0 1px 0 rgba(255,255,255,.025); border: 1px solid var(--docs-border); border-radius: .8rem; }
       .swagger-ui .scheme-container .schemes { align-items: flex-end; }
       .swagger-ui .schemes > label, .swagger-ui .servers-title { color: var(--docs-text-secondary); font-size: .74rem; font-weight: 800; letter-spacing: .04em; }
       .swagger-ui select, .swagger-ui input[type="text"], .swagger-ui input[type="email"], .swagger-ui input[type="password"], .swagger-ui textarea { min-height: 2.55rem; border: 1px solid #38506f; border-radius: .48rem; background: #091524; color: #f1f6ff; box-shadow: inset 0 1px 2px rgba(0,0,0,.2); font-size: .84rem; }
       .swagger-ui select { padding: .45rem 2rem .45rem .7rem; }
       .swagger-ui input::placeholder, .swagger-ui textarea::placeholder { color: #7f93af; opacity: 1; }
       .swagger-ui select:focus, .swagger-ui input:focus, .swagger-ui textarea:focus { border-color: var(--docs-accent); outline: 3px solid rgba(113,167,255,.2); }
       .swagger-ui .filter-container { margin: 0 0 1.5rem; padding: 0; }
       .swagger-ui .filter .operation-filter-input { width: min(100%, 22rem); border-color: #314866; background: #0c192b; color: var(--docs-text); }
       .swagger-ui .btn { border-color: #48658c; border-radius: .45rem; color: #e8f1ff; font-weight: 800; transition: transform .16s ease, border-color .16s ease, background-color .16s ease; }
       .swagger-ui .btn:hover { border-color: var(--docs-accent); background: #172943; box-shadow: none; transform: translateY(-1px); }
       .swagger-ui .btn:active { transform: translateY(0); }
       .swagger-ui .btn:focus-visible { outline: 3px solid rgba(113,167,255,.35); outline-offset: 2px; }
       .swagger-ui .btn.authorize { border-color: #54c9a0; color: #7ee2bd; }
       .swagger-ui .btn.authorize svg { fill: #7ee2bd; }

       .swagger-ui .opblock-tag { margin: 1.55rem 0 .65rem; padding: .8rem .35rem; border-bottom: 1px solid var(--docs-border); color: #f3f7ff; font-size: 1.08rem; font-weight: 800; letter-spacing: -.025em; }
       .swagger-ui .opblock-tag small { color: #adbed4; font-size: .76rem; font-weight: 600; opacity: 1; }
       .swagger-ui .opblock-tag svg, .swagger-ui .expand-operation svg, .swagger-ui .opblock-control-arrow svg { fill: #a9bad0; }
       .swagger-ui .opblock { margin: 0 0 .7rem; border-width: 1px; border-radius: .62rem; overflow: hidden; background: #0e1a2c; box-shadow: 0 8px 24px rgba(1,7,17,.12); }
       .swagger-ui .opblock .opblock-summary { min-height: 3.4rem; padding: .5rem .65rem; border-color: rgba(255,255,255,.07); }
       .swagger-ui .opblock .opblock-summary-method { min-width: 4.8rem; border-radius: .38rem; padding: .48rem .55rem; text-shadow: none; font-size: .7rem; font-weight: 800; letter-spacing: .04em; }
       .swagger-ui .opblock .opblock-summary-path, .swagger-ui .opblock .opblock-summary-path a { max-width: none; color: #e8f1ff; font-size: .82rem; font-weight: 600; opacity: 1; }
       .swagger-ui .opblock .opblock-summary-description { color: #c0cde0; font-size: .78rem; font-weight: 600; opacity: 1; }
       .swagger-ui .opblock .authorization__btn { margin-right: .35rem; }
       .swagger-ui .opblock .authorization__btn svg { fill: #9db0ca; }
       .swagger-ui .opblock.opblock-get { border-color: #4d96df; background: rgba(35,94,151,.16); }
       .swagger-ui .opblock.opblock-get .opblock-summary-method { background: #367fbd; }
       .swagger-ui .opblock.opblock-post { border-color: #45b88d; background: rgba(38,123,91,.15); }
       .swagger-ui .opblock.opblock-post .opblock-summary-method { background: #278865; }
       .swagger-ui .opblock.opblock-put, .swagger-ui .opblock.opblock-patch { border-color: #d0a451; background: rgba(145,105,32,.14); }
       .swagger-ui .opblock.opblock-put .opblock-summary-method, .swagger-ui .opblock.opblock-patch .opblock-summary-method { background: #a47727; }
       .swagger-ui .opblock.opblock-delete { border-color: #dd6d78; background: rgba(148,53,64,.15); }
       .swagger-ui .opblock.opblock-delete .opblock-summary-method { background: #b44451; }
       .swagger-ui .opblock-body { border-top: 1px solid rgba(255,255,255,.07); background: #0b1627; color: var(--docs-text-secondary); }
       .swagger-ui .opblock-description-wrapper, .swagger-ui .opblock-external-docs-wrapper, .swagger-ui .opblock-title_normal { padding: 1rem 1.25rem; }
       .swagger-ui .opblock-description-wrapper p, .swagger-ui .opblock-external-docs-wrapper p, .swagger-ui .opblock-title_normal p, .swagger-ui .markdown p { color: var(--docs-text-secondary); font-size: .84rem; line-height: 1.65; opacity: 1; }
       .swagger-ui .opblock-section-header { min-height: 3.4rem; padding: .75rem 1.25rem; background: #111f34; box-shadow: none; border-top: 1px solid #213653; border-bottom: 1px solid #213653; }
       .swagger-ui .opblock-section-header h4, .swagger-ui .opblock-section-header label { color: #edf4ff; font-weight: 800; }

       .swagger-ui table thead tr td, .swagger-ui table thead tr th { border-bottom-color: #2a3f5e; color: #dce8f8; font-size: .72rem; font-weight: 800; letter-spacing: .025em; }
       .swagger-ui table tbody tr td { border-bottom-color: rgba(57,79,111,.55); color: var(--docs-text-secondary); }
       .swagger-ui .parameter__name { color: #edf4ff; font-size: .82rem; font-weight: 800; }
       .swagger-ui .parameter__name.required:after { color: #ff909b; }
       .swagger-ui .parameter__type, .swagger-ui .prop-type { color: #8fbaff; font-size: .72rem; }
       .swagger-ui .parameter__deprecated, .swagger-ui .prop-format { color: #9aacc4; }
       .swagger-ui .parameter__extension, .swagger-ui .parameter__in { color: #8fa2bc; font-style: normal; }
       .swagger-ui .responses-inner h4, .swagger-ui .responses-inner h5, .swagger-ui .request-body h4, .swagger-ui .request-body h5 { color: #edf4ff; font-weight: 800; }
       .swagger-ui .response-col_status { color: #e8f1ff; font-family: "IBM Plex Mono", monospace; font-weight: 700; }
       .swagger-ui .response-col_description, .swagger-ui .response-col_links { color: var(--docs-text-secondary); }
       .swagger-ui .tab li button.tablinks { color: #aebfd5; font-family: "Manrope", sans-serif; font-weight: 700; }
       .swagger-ui .tab li.active button.tablinks { color: #f4f8ff; }
       .swagger-ui .tab li:first-of-type:after { background: var(--docs-accent); }
       .swagger-ui .highlight-code, .swagger-ui .microlight, .swagger-ui pre { border-radius: .5rem; background: #07111e !important; color: #dce8f8 !important; text-shadow: none; }
       .swagger-ui textarea.body-param__text { min-height: 10rem; font-family: "IBM Plex Mono", monospace; }

       .swagger-ui section.models { margin: 2rem 0 0; border: 1px solid var(--docs-border); border-radius: .7rem; background: #0d192a; }
       .swagger-ui section.models.is-open { padding: 0 1.2rem 1.2rem; }
       .swagger-ui section.models h4 { border-bottom-color: var(--docs-border); color: #eef4ff; font-size: 1rem; font-weight: 800; }
       .swagger-ui section.models h4 svg { fill: #a8bad1; }
       .swagger-ui .model-container { margin: 0 0 .6rem; border-radius: .48rem; background: #111f33; }
       .swagger-ui .model-box { background: transparent; color: var(--docs-text-secondary); }
       .swagger-ui .model-title, .swagger-ui .model { color: #dce8f8; }
       .swagger-ui .model-toggle:after { filter: invert(85%) sepia(12%) saturate(455%) hue-rotate(177deg); }
       .swagger-ui .model .property.primitive { color: #c2d2e6; }
       .swagger-ui .prop-name { color: #e8f1ff; }
       .swagger-ui .errors-wrapper { border-color: #c85a68; background: rgba(130,40,51,.15); }
       .swagger-ui .errors-wrapper hgroup h4, .swagger-ui .errors-wrapper .errors h4 { color: #ffb0b8; }

       @media (max-width: 720px) {
         .swagger-ui { padding-top: 1.4rem; }
         .swagger-ui .info .title { font-size: 2rem; }
         .swagger-ui .scheme-container { padding: 1rem; }
         .swagger-ui .scheme-container .schemes { align-items: stretch; flex-direction: column; gap: .8rem; }
         .swagger-ui .opblock .opblock-summary { align-items: flex-start; flex-wrap: wrap; gap: .4rem; }
         .swagger-ui .opblock .opblock-summary-method { min-width: 4.2rem; }
         .swagger-ui .opblock .opblock-summary-path { flex: 1 1 calc(100% - 5rem); overflow-wrap: anywhere; }
         .swagger-ui .opblock .opblock-summary-description { flex: 1 0 100%; padding-left: 5rem; }
       }
     </style>`,
  );
}

export function renderRedocDocs() {
  return shell(
    "Threadline API Reference — ReDoc",
    `<header class="docs-topbar">
      <a class="brand" href="/api-docs" aria-label="Threadline API documentation home"><span class="brand-mark">↝</span><span>threadline <small>API reference</small></span></a>
      <nav class="docs-nav" aria-label="Documentation views"><a href="/api-docs">Swagger UI</a><a href="/api-docs/redoc" aria-current="page">ReDoc</a><a href="/openapi.json">OpenAPI JSON</a><a href="/health">Health</a></nav>
    </header>
    <main id="main-content"><redoc spec-url="/openapi.json" hide-download-button="false" expand-responses="200,201,202" theme='{"colors":{"primary":{"main":"#71a7ff"},"text":{"primary":"#edf4ff","secondary":"#b6c5da"},"http":{"get":"#4d96df","post":"#45b88d","put":"#d0a451","delete":"#dd6d78"}},"typography":{"fontFamily":"Manrope, ui-sans-serif, system-ui, sans-serif","headings":{"fontFamily":"Manrope, ui-sans-serif, system-ui, sans-serif","fontWeight":"800"},"code":{"fontFamily":"IBM Plex Mono, ui-monospace, monospace"}},"sidebar":{"backgroundColor":"#0d1829","textColor":"#b6c5da","activeTextColor":"#91bbff"},"rightPanel":{"backgroundColor":"#07111e","textColor":"#edf4ff"}}'></redoc></main>
    <footer class="docs-footer">Reference rendered by ReDoc from the same versioned OpenAPI document.</footer>
    <script src="${redocBundle}" defer></script>`,
    `<style>
      redoc { display: block; min-height: calc(100vh - 150px); }

      /* ReDoc applies a light-theme alpha color to schema captions even when its
         surrounding content is dark. Keep these generated headings explicit so
         request/response schema metadata always meets dark-theme contrast. */
      redoc h5 {
        color: #c9d6e8 !important;
        opacity: 1 !important;
      }

      redoc h5 > span {
        color: inherit !important;
        opacity: 1 !important;
      }

      /* ReDoc's selected sample tab inherits right-panel textColor for both its
         text and its light selection surface. The semantic ARIA state is stable
         across generated class-name changes and gives the selected tab a clear,
         accessible dark-on-light treatment. */
      redoc [role="tab"][aria-selected="true"] {
        border-color: #b6c5da !important;
        background: #edf4ff !important;
        color: #07111e !important;
      }

      redoc [role="tab"]:focus-visible {
        outline: 3px solid rgba(113, 167, 255, .55);
        outline-offset: 2px;
      }
    </style>`,
  );
}
