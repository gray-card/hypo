#if os(iOS) && canImport(AuthenticationServices) && canImport(UIKit)
    import AuthenticationServices
    import Foundation
    import UIKit

    /// iOS browser presenter that accepts a callback only after redirect, state, and issuer checks.
    @MainActor
    public final class ASWebAuthenticationSessionPresenter: NSObject, OAuthBrowserPresenting,
        ASWebAuthenticationPresentationContextProviding
    {
        public typealias PresentationAnchorProvider = @MainActor @Sendable () -> ASPresentationAnchor

        private let presentationAnchorProvider: PresentationAnchorProvider
        private let prefersEphemeralWebBrowserSession: Bool
        private var activeSession: ASWebAuthenticationSession?

        public init(
            prefersEphemeralWebBrowserSession: Bool = false,
            presentationAnchorProvider: @escaping PresentationAnchorProvider
        ) {
            self.prefersEphemeralWebBrowserSession = prefersEphemeralWebBrowserSession
            self.presentationAnchorProvider = presentationAnchorProvider
        }

        public func authorize(_ request: BrowserAuthorizationRequest) async throws -> URL {
            guard activeSession == nil else {
                throw OAuthBrowserPresentationError.authorizationAlreadyInProgress
            }
            return try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { continuation in
                    let completionHandler: ASWebAuthenticationSession.CompletionHandler = {
                        [weak self] callbackURL, error in
                        Task { @MainActor [weak self] in
                            self?.activeSession = nil
                            if let authenticationError = error as? ASWebAuthenticationSessionError,
                                authenticationError.code == .canceledLogin
                            {
                                continuation.resume(throwing: OAuthBrowserPresentationError.cancelled)
                                return
                            }
                            if let error {
                                continuation.resume(throwing: error)
                                return
                            }
                            guard let callbackURL else {
                                continuation.resume(
                                    throwing: OAuthBrowserPresentationError.missingCallback)
                                return
                            }
                            do {
                                _ = try OAuthCallbackValidator.validate(callbackURL, for: request)
                                continuation.resume(returning: callbackURL)
                            } catch {
                                continuation.resume(throwing: error)
                            }
                        }
                    }
                    let session: ASWebAuthenticationSession
                    do {
                        session = try Self.makeSession(
                            request: request,
                            completionHandler: completionHandler
                        )
                    } catch {
                        continuation.resume(throwing: error)
                        return
                    }
                    session.presentationContextProvider = self
                    session.prefersEphemeralWebBrowserSession = prefersEphemeralWebBrowserSession
                    activeSession = session
                    guard session.start() else {
                        activeSession = nil
                        continuation.resume(throwing: OAuthBrowserPresentationError.presentationFailed)
                        return
                    }
                }
            } onCancel: {
                Task { @MainActor [weak self] in self?.activeSession?.cancel() }
            }
        }

        public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            presentationAnchorProvider()
        }

        private static func makeSession(
            request: BrowserAuthorizationRequest,
            completionHandler: @escaping ASWebAuthenticationSession.CompletionHandler
        ) throws -> ASWebAuthenticationSession {
            guard let scheme = request.redirectURI.scheme?.lowercased() else {
                throw OAuthBrowserPresentationError.invalidCallbackURI
            }
            if #available(iOS 17.4, macCatalyst 17.4, *) {
                let callback: ASWebAuthenticationSession.Callback
                if scheme == "https" {
                    guard let host = request.redirectURI.host else {
                        throw OAuthBrowserPresentationError.invalidCallbackURI
                    }
                    callback = .https(host: host, path: request.redirectURI.path)
                } else {
                    guard scheme != "http" else {
                        throw OAuthBrowserPresentationError.invalidCallbackURI
                    }
                    callback = .customScheme(scheme)
                }
                return ASWebAuthenticationSession(
                    url: request.authorizationURL,
                    callback: callback,
                    completionHandler: completionHandler
                )
            }
            guard scheme != "http" else {
                throw OAuthBrowserPresentationError.invalidCallbackURI
            }
            guard scheme != "https" else {
                throw OAuthBrowserPresentationError.httpsCallbackRequiresIOS17_4
            }
            return ASWebAuthenticationSession(
                url: request.authorizationURL,
                callbackURLScheme: scheme,
                completionHandler: completionHandler
            )
        }
    }
#endif
