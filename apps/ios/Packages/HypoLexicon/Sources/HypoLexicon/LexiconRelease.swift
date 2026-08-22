/// The released schema contract compiled into this client.
public enum LexiconRelease {
    /// The Panproto version used to inspect and migrate records.
    public static let panprotoVersion = "0.70.1"

    /// The first stable `app.graycard.*` suite snapshot.
    public static let schemaTag = "lexicons-v1"
}

/// Stable namespace identifiers used before generated models arrive in I1.3.
public enum GraycardNSID {
    public static let exposure = try! NSID("app.graycard.instance.exposure")
    public static let filmRoll = try! NSID("app.graycard.instance.filmRoll")
    public static let developSession = try! NSID("app.graycard.process.developSession")
    public static let meterReading = try! NSID("app.graycard.meter.reading")
}
