import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Hypo documentation",
  tagline: "Photographic metadata and AT Protocol schema reference",
  url: "https://hypo.graycard.app",
  baseUrl: "/docs/",
  organizationName: "gray-card",
  projectName: "hypo",
  trailingSlash: false,
  onBrokenLinks: "throw",
  markdown: {
    hooks: { onBrokenMarkdownLinks: "throw" },
  },
  staticDirectories: [resolve(siteDir, "static")],
  plugins: [
    function registryModuleCompatibility() {
      return {
        name: "registry-module-compatibility",
        configureWebpack() {
          return {
            module: {
              rules: [{ test: /[\\/]\.docusaurus[\\/].*\.js$/, type: "javascript/auto" }],
            },
          };
        },
      };
    },
  ],
  presets: [
    [
      "classic",
      {
        docs: {
          path: resolve(siteDir, ".."),
          routeBasePath: "/",
          sidebarPath: resolve(siteDir, "sidebars.mjs"),
          exclude: ["site/**", "design/**", "design-darkroom-scanning-workflow-rules.md", "enum-revamp.md"],
          editUrl: "https://github.com/gray-card/hypo/edit/main/docs/",
          showLastUpdateAuthor: true,
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: resolve(siteDir, "src/css/custom.css"),
        },
      },
    ],
  ],
  themeConfig: {
    colorMode: {
      defaultMode: "light",
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "HYPO / DOCS",
      hideOnScroll: true,
      items: [
        { to: "/", label: "Overview", position: "left", exact: true },
        { to: "/tutorials/", label: "Tutorials", position: "left" },
        { to: "/how-to/", label: "How-to", position: "left" },
        { to: "/explanation/", label: "Explanation", position: "left" },
        { to: "/reference/schema-status", label: "Schema status", position: "left" },
        { to: "/reference/lexicons/", label: "Lexicons", position: "left" },
        {
          href: "https://hypo.graycard.app/docs/ios-api/",
          label: "iOS API",
          position: "left",
        },
        {
          href: "https://github.com/gray-card/hypo",
          label: "GitHub",
          position: "right",
          "aria-label": "Hypo on GitHub",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Learn",
          items: [
            { label: "Tutorials", to: "/tutorials/" },
            { label: "How-to guides", to: "/how-to/" },
            { label: "Explanation", to: "/explanation/" },
          ],
        },
        {
          title: "Reference",
          items: [
            { label: "Schema status", to: "/reference/schema-status" },
            { label: "Lexicon NSIDs", to: "/reference/lexicons/" },
            { label: "Generated package", to: "/reference/generated-package" },
            {
              label: "iOS API",
              href: "https://hypo.graycard.app/docs/ios-api/",
            },
            { label: "Application contracts", to: "/reference/" },
          ],
        },
        {
          title: "Project",
          items: [
            { label: "Source", href: "https://github.com/gray-card/hypo" },
            { label: "Hypo", href: "https://hypo.graycard.app" },
          ],
        },
      ],
      copyright: `Hypo documentation · ${new Date().getFullYear()}`,
    },
  },
};

export default config;
