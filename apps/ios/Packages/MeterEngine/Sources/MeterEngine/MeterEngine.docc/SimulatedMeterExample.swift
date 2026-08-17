import MeterEngine

let camera = CameraDescriptor(
    id: "fixture-wide",
    name: "Fixture wide camera",
    module: .wide,
    horizontalFieldOfViewDegrees: 70
)

let sensor = try SimulatedMeterDevice.reflectedEVTrace(
    camera: camera,
    ev100Values: [8, 9, 10]
)
let meter = DefaultMeterEngine(sensor: sensor)
let configuration = try MeterConfiguration(
    mode: .reflectedAverage,
    samplingInterval: .zero
)

let reading = try await meter.capture(configuration: configuration)
precondition(reading.sensorPath == .simulated)
