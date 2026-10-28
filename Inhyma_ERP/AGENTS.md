# AI Assistant & Developer Guidelines

## Workspace Scope Rule (Rupesh Machine)

- **Default Target (`Inhyma_ERP` Only)**: Work exclusively inside `Inhyma_ERP` (`c:\Users\Inhyma Solutions\OneDrive\Desktop\ERP\Inhyma_ERP`). Do **not** modify `Yinglima_ERP` unless the user explicitly instructs you to make changes in `Yinglima_ERP`.
- **No Unsolicited Push**: Never run `git push` unless explicitly requested by the user.

## Living Documentation & Testing Manual Policy (Mandatory)

Whenever any features, functions, API endpoints, database schemas, frontend components, forms, fields, modals, or architecture components are added, modified, or removed in this codebase:

1. **Update `doc/SYSTEM_DOCUMENTATION.md`**:
   - Keep the file map, feature descriptions, and API route tables aligned with the current code.
   - If a new module, table, endpoint, page, or background worker is introduced, document its architecture, purpose, and usage in `doc/SYSTEM_DOCUMENTATION.md`.
   - Update the **Last Updated** timestamp and relevant section numbers.

2. **Update `MODULES_AND_FEATURES_TEST_MANUAL.md`**:
   - Keep the complete catalog of all UI views, tables, forms, fields, dropdown sources, action buttons, modals, and test checklists aligned with the active frontend.
   - If a new button, form tab, input field, modal, calculation, or module is introduced or edited, document its exact UI specifications, required validations, and test cases in `MODULES_AND_FEATURES_TEST_MANUAL.md`.

3. **Zero Inaccuracies & Zero Feature Loss**:
   - Ensure file paths, schema references, and code references reflect the exact codebase state.
   - Never remove or break existing cataloged features during development.

