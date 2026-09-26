import SwiftUI

#if canImport(AVFoundation)
    @preconcurrency import AVFoundation

    /// Supplies the exact capture session used by the meter. MeterFeature never opens a second
    /// session because two sessions may contend for the same camera and invalidate measurements.
    @MainActor
    public protocol MeterPreviewSessionProviding: AnyObject {
        var meterPreviewSession: AVCaptureSession? { get }
    }

    #if canImport(UIKit)
        import UIKit

        public struct MeterCameraPreview: UIViewRepresentable {
            private let session: AVCaptureSession

            public init(session: AVCaptureSession) {
                self.session = session
            }

            public func makeUIView(context _: Context) -> PreviewView {
                let view = PreviewView()
                view.previewLayer.videoGravity = .resizeAspectFill
                view.previewLayer.session = session
                return view
            }

            public func updateUIView(_ view: PreviewView, context _: Context) {
                if view.previewLayer.session !== session {
                    view.previewLayer.session = session
                }
            }

            public final class PreviewView: UIView {
                override public class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }

                var previewLayer: AVCaptureVideoPreviewLayer {
                    layer as! AVCaptureVideoPreviewLayer
                }
            }
        }
    #elseif canImport(AppKit)
        import AppKit

        public struct MeterCameraPreview: NSViewRepresentable {
            private let session: AVCaptureSession

            public init(session: AVCaptureSession) {
                self.session = session
            }

            public func makeNSView(context _: Context) -> PreviewView {
                PreviewView(session: session)
            }

            public func updateNSView(_ view: PreviewView, context _: Context) {
                if view.previewLayer.session !== session {
                    view.previewLayer.session = session
                }
            }

            public final class PreviewView: NSView {
                let previewLayer = AVCaptureVideoPreviewLayer()

                init(session: AVCaptureSession) {
                    super.init(frame: .zero)
                    wantsLayer = true
                    previewLayer.videoGravity = .resizeAspectFill
                    previewLayer.session = session
                    layer = previewLayer
                }

                @available(*, unavailable)
                required init?(coder _: NSCoder) { nil }

                override public func layout() {
                    super.layout()
                    previewLayer.frame = bounds
                }
            }
        }
    #endif
#endif
