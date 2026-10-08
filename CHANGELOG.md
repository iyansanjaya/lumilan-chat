# Changelog

[Bahasa Indonesia](CHANGELOG.id.md)

## 1.2.0

Changes from version 1.1.0.

### Added

- **Unread conversations first.** Connected contacts with unread private messages now appear above contacts whose messages have been read. Each group keeps alphabetical name order in the selected language. Once you read a conversation in the active app window, its contact returns to the normal order. Lumi previews do not mark messages as read.

### Changed

- Migrated the application, preload modules, tests, and Node scripts to **strict TypeScript**, with shared communication contracts and separate type checks for the desktop, renderer, and preload environments.
- Updated the build and packaging process to use freshly compiled application files and copied runtime assets. Application source TypeScript, development scripts, tests, and source maps are excluded from release packages.

### Build and validation

- Updated package verification for the compiled layout, including required interface assets, runtime modules, standalone sandboxed preloads, and the macOS application icon.
- Expanded automated validation across **Windows x64, macOS Intel and Apple Silicon, and Linux x64**, including X11 and Wayland. The build workflow repeats type checks, automated tests, full 5 GB transfer tests, and packaged application smoke tests three times.
- Added regression checks for unread ordering, reading a conversation, duplicate contact names, reconnections, search and archive filters, and supported interface languages.
- Improved Linux test setup with CJK fallback fonts and isolated Wayland input for interface and notification fallback checks.

### Platform notes

- Lumi uses the desktop overlay on Windows, macOS, and Linux X11. Linux Wayland uses system notifications.
- Current packages are unsigned. Windows or macOS may display a publisher warning; macOS system notifications require a signed application. Download packages from the [official Releases page](https://github.com/iyansanjaya/lumilan-chat/releases).
