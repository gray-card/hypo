---
title: Accessibility audit record
description: Current automated coverage and the temporary manual screen-reader waiver.
---

# Accessibility audit record

Last reviewed: 2026-08-12

This record covers the current Hypo web application. Automated WCAG 2.0 and 2.1 A/AA checks run with axe in unit and Chromium end-to-end tests for the login, setup, galleries, editor, and shot-logging flows. The end-to-end suite also exercises keyboard order, visible focus, modal focus containment and restoration, landmarks, and keyboard activation. These checks reduce regression risk; they do not establish WCAG conformance.

## Manual screen-reader status

Manual VoiceOver testing in Safari on macOS has **not yet been performed** for this release. No claim of VoiceOver support or complete screen-reader accessibility is being made. The project is carrying a temporary waiver for that missing manual audit.

The waiver must be closed before a production-readiness or WCAG-conformance claim. Closure requires a keyboard-only and VoiceOver pass through sign-in, setup, gallery creation, editor photo selection, shoot logging, offline-queue feedback, settings, and error recovery. Findings must be recorded with the tested macOS and Safari versions, and blocking issues must be fixed or documented individually with an owner and review date.
