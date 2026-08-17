import Foundation
import HypoLexicon

public enum FilmRollDevelopmentMergeError: Error, Equatable, Sendable {
    case malformedRecord(String)
    case wrongRecordType(String?)
    case conflictingMilestone(String)
    case unknownStatus(String)
    case invalidChronology([ConsumableLifecycleIssue])
}

/// Applies the development transition to the hydrated wire object. The merge changes only
/// lifecycle fields, retaining unknown fields and any schema-evolution complements in the body.
public enum FilmRollDevelopmentRecordMerger {
    public static func merge(
        record data: Data,
        request: FilmRollDevelopmentAdvanceRequest
    ) throws -> Data {
        let roll: AppGraycardInstanceFilmRollMain
        do {
            roll = try JSONDecoder().decode(AppGraycardInstanceFilmRollMain.self, from: data)
        } catch {
            throw FilmRollDevelopmentMergeError.malformedRecord(String(describing: error))
        }
        guard roll.recordType == "app.graycard.instance.filmRoll" else {
            throw FilmRollDevelopmentMergeError.wrongRecordType(roll.recordType)
        }
        try requireSameDate(
            roll.developmentStartedAt,
            request.developmentStartedAt,
            field: "developmentStartedAt"
        )
        try requireSameDate(roll.developedAt, request.developedAt, field: "developedAt")

        let status = try mergedStatus(current: roll.status?.rawValue, requested: request.status)
        let milestones = FilmRollMilestones(
            loadedAt: roll.loadedAt,
            partialAt: roll.partialAt,
            exposedAt: roll.exposedAt,
            unloadedAt: roll.unloadedAt,
            sentToLabAt: roll.sentToLabAt,
            developmentStartedAt: roll.developmentStartedAt ?? request.developmentStartedAt,
            developedAt: roll.developedAt ?? request.developedAt,
            receivedFromLabAt: roll.receivedFromLabAt,
            scannedAt: roll.scannedAt,
            archivedAt: roll.archivedAt
        )
        let issues = ConsumableLifecycleValidator.validate(milestones)
        guard issues.isEmpty else {
            throw FilmRollDevelopmentMergeError.invalidChronology(issues)
        }

        if roll.developmentStartedAt != nil,
            roll.developedAt != nil,
            roll.status?.rawValue == status,
            roll.developmentLocation?.rawValue == request.developmentLocation,
            (roll.updatedAt?.date ?? .distantPast) >= request.developedAt.date
        {
            return data
        }

        let json: Any
        do {
            json = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw FilmRollDevelopmentMergeError.malformedRecord(String(describing: error))
        }
        guard var object = json as? [String: Any] else {
            throw FilmRollDevelopmentMergeError.malformedRecord("The record is not an object.")
        }
        object["status"] = status
        object["developmentStartedAt"] = request.developmentStartedAt.rawValue
        object["developedAt"] = request.developedAt.rawValue
        object["developmentLocation"] = request.developmentLocation
        if roll.updatedAt == nil || (roll.updatedAt?.date ?? .distantPast) < request.developedAt.date {
            object["updatedAt"] = request.developedAt.rawValue
        }
        do {
            return try JSONSerialization.data(
                withJSONObject: object,
                options: [.sortedKeys, .withoutEscapingSlashes]
            )
        } catch {
            throw FilmRollDevelopmentMergeError.malformedRecord(String(describing: error))
        }
    }

    private static func requireSameDate(
        _ current: ATProtoDate?,
        _ requested: ATProtoDate,
        field: String
    ) throws {
        guard let current else { return }
        guard current.date == requested.date else {
            throw FilmRollDevelopmentMergeError.conflictingMilestone(field)
        }
    }

    private static func mergedStatus(current: String?, requested: String) throws -> String {
        let ranks = [
            "loaded": 0,
            "partial": 1,
            "exposed": 2,
            "at-lab": 3,
            "developing": 4,
            "developed": 5,
            "scanned": 6,
            "archived": 7,
        ]
        guard let requestedRank = ranks[requested] else {
            throw FilmRollDevelopmentMergeError.unknownStatus(requested)
        }
        guard let current else { return requested }
        guard let currentRank = ranks[current] else {
            throw FilmRollDevelopmentMergeError.unknownStatus(current)
        }
        return currentRank > requestedRank ? current : requested
    }
}
