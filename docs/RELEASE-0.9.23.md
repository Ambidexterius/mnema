# Release 0.9.23

- Project report status appears beside the category badge.
- XLS uploads are supported alongside XLSX. Both formats open as tables in the material and source-file windows, with sheet names, original row numbers and column letters. Preview limits are explicit: files up to 20 MB, the first 1,000 populated rows and 100 columns per sheet. Stored values are displayed; formulas, macros and external links are never executed. Excel formatting is not reproduced.
- Includes invitation email delivery and existing-account project notifications from 0.9.22. Missing SMTP configuration retains manual invitation links. Transcription notifications and access checks are preserved.

Validation: typecheck, server tests, production build and browser checks on synthetic data. No production research is included in this release.

Runtime: xlrd 2.0.2 added to server/requirements-asr.txt. Use the full Docker build; the previous runtime alone cannot read XLS. Configure SMTP credentials only in the hosting environment. This release does not create users or send test messages automatically.
