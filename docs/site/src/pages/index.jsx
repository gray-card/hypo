import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";
import summary from "../data/lexicon-summary.json";
import styles from "./index.module.css";

const stages = ["capture", "develop", "digitize", "edit", "publish"];

const paths = [
  {
    label: "Start with Hypo",
    description: "Add film reserve, load a roll, start a shoot, and log the first frame.",
    to: "/tutorials/getting-started",
    action: "Open getting started",
  },
  {
    label: "Complete a task",
    description: "Log shots, run workflows, time development, or manage photographic metadata.",
    to: "/how-to/",
    action: "Choose a how-to",
  },
  {
    label: "Inspect an NSID",
    description: "Read resolved fields, refs, constraints, and open known-value sets.",
    to: "/reference/lexicons/",
    action: "Browse the lexicons",
  },
];

export default function Home() {
  return (
    <Layout title="Overview" description="Documentation for Hypo and the app.graycard metadata model.">
      <main className={styles.main}>
        <header className={styles.hero}>
          <div className={styles.registrationMark} aria-hidden="true">
            HY
          </div>
          <p className={styles.eyebrow}>Hypo / app.graycard</p>
          <h1>Metadata for the whole photographic chain.</h1>
          <p className={styles.lede}>
            Hypo records what happened before, during, and after exposure. The shared lexicons keep that chain portable
            across AT Protocol clients.
          </p>
          <p className={styles.scopeNote}>
            These pages currently document Hypo for web. Documentation for Hypo for iOS will be added here when that
            client ships. Gray Card is a separate, full-featured photo editor with a scope comparable to Lightroom. It
            uses the same <code>app.graycard.*</code> metadata model, but its editing features are documented
            separately.
          </p>
          <div className={styles.actions}>
            <Link className="button button--primary button--lg" to="/tutorials/getting-started">
              Get started with Hypo
            </Link>
            <Link className={styles.textLink} to="/reference/lexicons/">
              Browse {summary.nsids} NSIDs <span aria-hidden="true">→</span>
            </Link>
          </div>
        </header>

        <section className={styles.process} aria-labelledby="process-title">
          <div className={styles.processHeading}>
            <p>One provenance chain</p>
            <h2 id="process-title">From shutter to published photograph</h2>
          </div>
          <ol className={styles.processRail}>
            {stages.map((stage, index) => (
              <li key={stage}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {stage}
              </li>
            ))}
          </ol>
          <dl className={styles.counts} aria-label="Lexicon counts">
            <div>
              <dt>NSIDs</dt>
              <dd>{summary.nsids}</dd>
            </div>
            <div>
              <dt>Record collections</dt>
              <dd>{summary.records}</dd>
            </div>
            <div>
              <dt>Definitions</dt>
              <dd>{summary.definitions}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.paths} aria-labelledby="paths-title">
          <div className={styles.sectionLabel}>
            <span>Choose by intent</span>
            <h2 id="paths-title">What do you need to do?</h2>
          </div>
          <div className={styles.pathGrid}>
            {paths.map((path) => (
              <article key={path.label} className={styles.pathCard}>
                <h3>{path.label}</h3>
                <p>{path.description}</p>
                <Link to={path.to}>
                  {path.action} <span aria-hidden="true">↗</span>
                </Link>
              </article>
            ))}
          </div>
        </section>
      </main>
    </Layout>
  );
}
