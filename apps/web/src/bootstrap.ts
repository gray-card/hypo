import { libraryTabForRecord, type LibraryRecordTarget } from "./routes/library-record-history";

export interface CachedLoader<Module> {
  (): Promise<Module>;
  peek(): Module | undefined;
}

/** Cache a lazy feature import while allowing a failed request to be retried. */
export function cachedImport<Module>(importer: () => Promise<Module>): CachedLoader<Module> {
  let value: Module | undefined;
  let pending: Promise<Module> | undefined;
  const load = (() => {
    if (value) return Promise.resolve(value);
    if (!pending) {
      pending = importer()
        .then((module) => {
          value = module;
          return module;
        })
        .catch((error: unknown) => {
          pending = undefined;
          throw error;
        });
    }
    return pending;
  }) as CachedLoader<Module>;
  load.peek = () => value;
  return load;
}

export interface AppRoute {
  name: string;
  params: Readonly<Record<string, string | undefined>>;
}

interface AppRouter {
  current(): AppRoute;
  subscribe(listener: (route: AppRoute) => void): unknown;
}

interface SessionState {
  agent: unknown;
  did: string | null | undefined;
}

interface AuthenticatedSession {
  agent: unknown;
  did: string;
}

interface SessionController {
  bootstrap(): Promise<unknown>;
  clearOAuthCallbackParams(): void;
}

interface OutboxModule {
  installAutoFlush(agent: unknown, did: string, onFlushed: (result: { sent?: number }) => void): unknown;
}

interface LibraryFeature {
  getStore(): unknown;
}

interface OnboardingModule {
  needsOnboarding(store: unknown, did: string): boolean;
  openOnboarding(options: {
    agent: unknown;
    did: string | null | undefined;
    onDone(destination?: string): void;
  }): unknown;
}

interface BootstrapLogger {
  warn(...values: unknown[]): void;
}

export interface AppBootstrapServices {
  router: AppRouter;
  session(): SessionState;
  setSession(session: AuthenticatedSession): void;
  showAuthenticated(did: string): unknown;
  showLoggedOut(): unknown;
  loadOutbox(): Promise<OutboxModule>;
  loadOnboarding(): Promise<OnboardingModule>;
  libraryFeature(): Promise<LibraryFeature>;
  openLibraryRecord(target: LibraryRecordTarget): Promise<unknown>;
  closeLibraryRecord(): unknown;
  goSection(section: "setup" | "galleries" | "following" | "discover"): unknown;
  navigateSection(section: string): unknown;
  setLibraryTab(tab: string): void;
  setActiveSection(section: string): void;
  showView(view: string): void;
  openGallery(uri: string): unknown;
  openMeter(): unknown;
  showProfile(handle: string): unknown;
  showFeatureLoadError(target: string, error: unknown): void;
  setLoginError(message: string): void;
  toast(message: string, kind?: string): unknown;
  logger?: BootstrapLogger;
}

const ONBOARDING_ROUTES = new Set(["home", "library", "roll", "gear", "timer", "meter"]);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message || String(error) : String(error));
const logDetail = (error: unknown): unknown =>
  error && typeof error === "object" && "message" in error ? (error as { message?: unknown }).message || error : error;

export function isPublicProfileRoute(route: AppRoute): boolean {
  if (route.name !== "profile" && route.name !== "profileSection") return false;
  const handle = route.params.handle;
  return Boolean(handle && (handle.includes(".") || handle.startsWith("did:")));
}

export function routeErrorTarget(route: AppRoute): string {
  if (route.name === "gallery") return "#editor-body";
  if (route.name === "following") return "#following-body";
  if (route.name === "profile" || route.name === "profileSection" || route.name === "discover") {
    return "#profile-body";
  }
  return "#library-body";
}

/** Coordinate authenticated startup, route dispatch, lazy failures, and onboarding. */
export function createAppBootstrap(services: AppBootstrapServices) {
  const logger = services.logger || console;
  let routeRenderRevision = 0;
  let autoFlushRevision = 0;
  let disposeAutoFlush = (): void => {};

  const stopAutoFlush = (): void => {
    disposeAutoFlush();
    disposeAutoFlush = () => {};
  };

  const setupRoute = (tab?: string): unknown => {
    if (!services.session().agent) return services.showLoggedOut();
    if (tab) services.setLibraryTab(tab);
    return services.goSection("setup");
  };

  const recordRouteMatches = (target: LibraryRecordTarget): boolean => {
    const route = services.router.current();
    if (target.type === "roll") return route.name === "roll" && route.params.rkey === target.rkey;
    return route.name === "gear" && route.params.kind === target.kind && route.params.rkey === target.rkey;
  };

  const setupRecordRoute = async (target: LibraryRecordTarget): Promise<unknown> => {
    if (!services.session().agent) return services.showLoggedOut();
    await setupRoute(libraryTabForRecord(target));
    if (recordRouteMatches(target)) return services.openLibraryRecord(target);
  };

  const routeHandlers: Record<string, (route: AppRoute) => unknown> = {
    home: () => setupRoute(),
    galleries: () => (services.session().agent ? services.goSection("galleries") : services.showLoggedOut()),
    library: (route) => setupRoute(route.params.tab),
    gallery: (route) => {
      const session = services.session();
      if (!session.agent) return services.showLoggedOut();
      services.setActiveSection("galleries");
      services.showView("editor-view");
      return services.openGallery(`at://${session.did}/social.grain.gallery/${route.params.rkey}`);
    },
    roll: (route) => setupRecordRoute({ type: "roll", rkey: route.params.rkey as string }),
    gear: (route) =>
      setupRecordRoute({
        type: "gear",
        kind: route.params.kind as string,
        rkey: route.params.rkey as string,
      }),
    timer: () => setupRoute("darkroom"),
    meter: () => services.openMeter(),
    following: () => (services.session().agent ? services.goSection("following") : services.showLoggedOut()),
    discover: () => (services.session().agent ? services.goSection("discover") : services.showLoggedOut()),
    profile: (route) => services.showProfile(route.params.handle as string),
    profileSection: (route) => services.showProfile(route.params.handle as string),
    notFound: () => (services.session().agent ? services.goSection("setup") : services.showLoggedOut()),
  };

  const renderRoute = async (route: AppRoute): Promise<void> => {
    const revision = ++routeRenderRevision;
    const handler = routeHandlers[route.name] || routeHandlers.notFound;
    try {
      services.closeLibraryRecord();
      await handler(route);
    } catch (error) {
      if (revision !== routeRenderRevision) return;
      services.showFeatureLoadError(routeErrorTarget(route), error);
      services.toast(`View couldn't load: ${messageOf(error)}`, "err");
    }
  };

  const startOnboarding = async (): Promise<unknown> => {
    const onboarding = await services.loadOnboarding();
    const session = services.session();
    return onboarding.openOnboarding({
      agent: session.agent,
      did: session.did,
      onDone: (destination = "setup") => {
        if (destination.startsWith("setup-")) {
          services.setLibraryTab(destination.slice("setup-".length));
          services.navigateSection("setup");
        } else {
          services.navigateSection(destination);
        }
      },
    });
  };

  const maybeStartOnboarding = async (): Promise<void> => {
    const session = services.session();
    if (!session.agent || !session.did || !ONBOARDING_ROUTES.has(services.router.current().name)) return;
    const [library, onboarding] = await Promise.all([services.libraryFeature(), services.loadOnboarding()]);
    if (onboarding.needsOnboarding(library.getStore(), session.did)) await startOnboarding();
  };

  const onAuthenticated = ({ agent, did }: AuthenticatedSession): void => {
    const revision = ++autoFlushRevision;
    stopAutoFlush();
    services.setSession({ agent, did });
    services
      .loadOutbox()
      .then(({ installAutoFlush }) => {
        if (revision !== autoFlushRevision) return;
        const dispose = installAutoFlush(agent, did, (result) => {
          if (result.sent) {
            services.toast(`Synced ${result.sent} offline shot${result.sent === 1 ? "" : "s"}`, "ok");
          }
        });
        if (typeof dispose === "function") disposeAutoFlush = dispose as () => void;
      })
      .catch((error: unknown) => logger.warn("Offline sync could not start:", logDetail(error)));
    void services.showAuthenticated(did);
  };

  const onLoggedOut = (): unknown => {
    autoFlushRevision += 1;
    stopAutoFlush();
    return services.showLoggedOut();
  };

  const start = async (sessionController: SessionController): Promise<void> => {
    services.router.subscribe((route) => {
      void renderRoute(route);
    });
    try {
      await sessionController.bootstrap();
    } catch (error) {
      sessionController.clearOAuthCallbackParams();
      onLoggedOut();
      await renderRoute(services.router.current());
      if (!isPublicProfileRoute(services.router.current())) {
        services.setLoginError("Couldn't restore your session. Please sign in again.");
      }
      logger.warn("startup init failed:", logDetail(error));
      return;
    }

    await renderRoute(services.router.current());
    try {
      await maybeStartOnboarding();
    } catch (error) {
      logger.warn("Onboarding could not start:", logDetail(error));
    }
  };

  return {
    maybeStartOnboarding,
    onAuthenticated,
    onLoggedOut,
    renderRoute,
    start,
    startOnboarding,
  };
}
