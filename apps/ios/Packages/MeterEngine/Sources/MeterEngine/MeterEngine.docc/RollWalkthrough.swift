import HypoLexicon
import LoggerFeature

let rollURI = try ATURI(
    "at://did:plc:example/app.graycard.instance.filmRoll/tutorial-roll"
)

var milestones = FilmRollMilestones()
milestones.loadedAt = try ATProtoDate("2026-08-14T13:00:00Z")

let activeRoll = ActiveRoll(
    uri: rollURI,
    label: "Roll 12",
    stockName: "HP5 Plus",
    exposureIndex: 400,
    exposuresTotal: 36,
    milestones: milestones
)

let model = await LoggerFeatureModel(
    activeRoll: activeRoll,
    writer: DiscardingExposureWriter()
)
await model.setExposureIndexOverrideEnabled(true)
await model.logFrame()
