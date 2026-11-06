# Manager Portal Native Content Editing Design

Date: 2026-08-06
Status: Approved direction
Release target: 1.5.2 (build 14)

## Objective

Replace the raw JSON viewers in the Manager Portal native clients with safe,
task-oriented management screens for the most frequently edited content. Ship
the resulting Android, iOS, macOS, and HarmonyOS packages through the existing
private Manager Portal download flow.

## Scope

The release covers five content areas:

- Media: list files, edit metadata, and delete a file after confirmation.
- Downloads: list packages and resources, edit metadata, and delete a file
  after confirmation.
- Documents: list documents, edit metadata, and delete a file after
  confirmation.
- Websites: add, edit, and delete recommended websites.
- Works: edit publication metadata and delete a work after confirmation.

Binary uploads remain in the existing web upload workflow for this release.
Native file pickers and chunked uploads are outside this scope because they
need separate platform-specific background transfer and recovery behavior.

Source code, stock management, terminal commands, security configuration, and
administrator management keep their dedicated interfaces. The release does
not add a generic JSON write endpoint.

## Architecture

### Server-owned capabilities

The API remains the source of truth for which records, fields, and operations
are available. Each native content module receives a normalized workspace
document containing:

- module identity and display title;
- records with stable identifiers;
- field definitions, labels, types, editability, and length limits;
- permitted actions for the current administrator;
- revision information used to reject stale edits.

Mutations use one Manager Portal action route with an explicit server-side
allowlist. The client submits a module id, action, record id, revision, and
validated field values. The server maps that request to the existing domain
operation for media metadata, website management, or works management.

The action route must never accept an arbitrary URL, HTTP method, filesystem
path, or unbounded JSON document from the client.

### Native clients

Android, iOS, macOS, and HarmonyOS consume the same normalized workspace
contract and render native controls:

- compact record lists for scanning;
- labeled text fields and multiline fields for editing;
- menus for categories and other bounded choices;
- save buttons only when the administrator has the required permission;
- destructive buttons separated from normal actions and protected by a
  confirmation dialog;
- explicit loading, empty, validation, saving, success, and retry states.

Unknown fields are shown as labeled read-only values. They are never dumped as
raw JSON. Unknown actions are ignored by the client and rejected by the API.

## Module Behavior

### Media, downloads, and documents

The API normalizes all three areas to file records. Editable metadata includes
title, category, remarks, links, and the media-specific artist and lyrics
fields when applicable. Filename, byte size, modification time, and public URL
remain read-only.

Deleting a file requires a second confirmation that names the target. The
server removes the file and its metadata entry atomically enough that a failed
metadata cleanup is reported and logged rather than silently presented as a
complete success.

### Websites

The native form supports name, URL, description, category, and icon URL. URL
and text validation run on both client and server. Editing preserves the stable
site id. Delete requires confirmation and refreshes the list after success.

### Works

The native form supports title, description, category, version, run URL, cover
URL, language, and author. Source files, deployed directories, server process
fields, ownership ids, and executable code are read-only in this release.
Delete uses the existing protected work deletion behavior so associated deploy
cleanup remains centralized on the server.

## Authentication And Authorization

- Every read and write requires a valid administrator session token.
- The server checks the module-specific permission on every request; client
  visibility is not treated as authorization.
- A 401 response clears the local token, username, cached permissions, and
  workspace data, then returns the client to login.
- A 403 response keeps the session but removes the unavailable action and
  explains that the account lacks permission.
- Write requests include a revision. A stale revision returns 409 and asks the
  client to refresh before retrying.
- Mutations are recorded in the existing administrator audit log without
  logging tokens or full sensitive payloads.

## Error Handling

Validation errors stay attached to the relevant field. Network failures keep
unsaved form values and expose a retry action. A successful mutation refreshes
the affected record from the server rather than assuming the submitted values
were stored unchanged.

The clients must distinguish JSON API responses from HTML error pages and show
a service error instead of rendering response bodies. A missing or expired
token always follows the logout behavior above.

## Release And Downloads

The four native clients move to version 1.5.2, build 14. The build pipeline
produces:

- ManagerPortal-macOS-v1.5.2.dmg
- ManagerPortal-iOS-v1.5.2-unsigned.ipa
- ManagerPortal-Android-v1.5.2.apk
- ManagerPortal-HarmonyOS-v1.5.2-unsigned.hap

The build script updates the private `manager_portal/apps.json` manifest with
the new version, sizes, SHA-256 values, and release notes. Manager Portal
packages remain excluded from the public app manifest and public download
center. Authenticated users obtain a short-lived download ticket from the
Manager Portal home page.

## Testing

Server tests cover:

- normalized workspace records for all five modules;
- the action allowlist and rejection of arbitrary endpoints or methods;
- permission checks for every module and action;
- field length, URL, id, filename, and revision validation;
- expired sessions, stale revisions, and destructive confirmations;
- successful metadata, website, and work mutations.

Client contract checks verify that all four sources support structured fields,
save and delete actions, 401 logout, 403 permission handling, and no raw JSON
workspace fallback. Android and macOS receive full local builds. iOS and
HarmonyOS receive compile/build checks when their installed SDKs are available;
unsigned package limitations remain clearly labeled in the manifest.

## Success Criteria

- The five scoped modules never present their primary workspace as raw JSON.
- Authorized administrators can complete the specified edits from each native
  client without opening a WebView.
- Unauthorized or stale writes are rejected by the API.
- Expired sessions immediately return to login and remove local credentials.
- Version 1.5.2 build 14 appears in the authenticated Manager Portal package
  section, and each available package matches its published SHA-256 value.
- Manager Portal packages remain unavailable through public download routes.
