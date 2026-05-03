# Thunderbird Slack Provider

A [Thunderbird](https://www.thunderbird.net/) WebExtension that lets you read and write Slack messages without leaving your email client.

---

## Features

| Feature | Details |
|---------|---------|
| **Channel list** | All Slack channels you are a member of appear in the left panel. |
| **Unread badges** | Channels with unread messages are shown in **bold** (Thunderbird style). |
| **Message thread** | Click a channel to see its messages in the right panel, newest at the bottom. |
| **Compose & send** | Type in the box at the bottom; press **Enter** to send (Shift+Enter for a new line). |
| **Reply in thread** | Every message has a **Reply** button. Replies are sent as Slack threads and are also broadcast to the channel. |
| **Live updates** | The extension polls Slack every 30 seconds to refresh messages and unread counts. |

---

## Building on Linux

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| `zip` | any | `sudo apt install zip` |
| `python3` | ≥ 3.6 | `sudo apt install python3` |
| `git` | any | `sudo apt install git` |

No Node.js or Rust toolchain is required. The extension is pure JavaScript / HTML / CSS.

> **Minimum Thunderbird version: 128.0** (the Supernova UI rework and the stable Spaces API both require Thunderbird 128+).

### Steps

```bash
# Clone the repository
git clone https://github.com/gortazar/thunderbird-slack-provider.git
cd thunderbird-slack-provider

# Extract the version number from the manifest
VERSION=$(python3 -c "import json; print(json.load(open('src/manifest.json'))['version'])")

# Package all source files into an .xpi file (a renamed .zip)
mkdir -p dist
cd src
zip -r "../dist/thunderbird-slack-provider-${VERSION}.xpi" .
cd ..

echo "Built: dist/thunderbird-slack-provider-${VERSION}.xpi"
```

The resulting `.xpi` file contains everything needed for installation.

---

## Allowing the Extension to Access Your Slack Workspace

The extension uses the **Slack Web API** with a Bot or User OAuth token.

### 1 — Create a Slack App

1. Go to <https://api.slack.com/apps> and click **Create New App → From scratch**.
2. Give it a name (e.g. *Thunderbird Slack Provider*) and choose your workspace.

### 2 — Grant the Required Scopes

Navigate to **OAuth & Permissions → Scopes**.

Add the following **Bot Token Scopes**:

| Scope | Purpose |
|-------|---------|
| `channels:read` | List public channels |
| `groups:read` | List private channels |
| `channels:history` | Read public channel messages |
| `groups:history` | Read private channel messages |
| `chat:write` | Post messages |
| `users:read` | Resolve display names and avatars |
| `channels:manage` *(optional)* | Mark channels as read |

### 3 — Install the App to Your Workspace

1. Click **Install to Workspace** on the **OAuth & Permissions** page.
2. Authorise the permissions.
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`).

### 4 — Enter the Token in Thunderbird

1. Open Thunderbird and navigate to the Slack space (Slack icon in the left toolbar).
2. If not yet configured, click **Open Settings**.  
   Alternatively: **Tools → Add-ons and Themes → Thunderbird Slack Provider → Preferences**.
3. Paste your token and click **Save Token**.
4. Click **Test Connection** to verify everything works.

> **Tip – User Token vs Bot Token**  
> A *Bot Token* (`xoxb-`) only sees channels the bot has been invited to.  
> A *User Token* (`xoxp-`) sees all channels the human user can access.  
> For personal use, a User Token with the same scopes is often more convenient.

---

## Installing the Extension

### Option A — Install from the pre-built release

1. Download the latest `.xpi` from the [Releases](../../releases) page.
2. Follow **Option B → Step 3** below.

### Option B — Install a locally-built `.xpi`

#### Standard (non-snap) Thunderbird

```bash
# Open Thunderbird
thunderbird &
```

1. In Thunderbird open **Tools → Add-ons and Themes** (or press `Ctrl+Shift+A`).
2. Click the ⚙️ gear icon → **Install Add-on From File…**.
3. Browse to `dist/thunderbird-slack-provider-<version>.xpi` and click **Open**.
4. Click **Add** on the confirmation dialog.
5. The Slack icon will appear in the **Spaces toolbar** on the left side of the Thunderbird window.

#### Snap-installed Thunderbird

Snap packages use strict confinement and mount the application in a read-only filesystem.  
Install the add-on through the Thunderbird UI in exactly the same way:

```bash
# Launch the snap version
snap run thunderbird &
```

Then follow steps 1–5 from the standard installation above.  
The Add-on Manager is identical regardless of how Thunderbird was installed.

> **Note:** Thunderbird requires add-ons to be signed by Mozilla for automatic installation in release builds.  
> To install an unsigned add-on locally:
> 1. Go to `about:config` in a Thunderbird compose window (or open it via the URL bar in a tab).
> 2. Set `xpinstall.signatures.required` to `false`.
> 3. Restart Thunderbird.
>
> Alternatively, use the [Developer Edition](https://www.thunderbird.net/en-US/thunderbird/all/#T-Daily) of Thunderbird, which has signature enforcement disabled by default.

### Option C — Persistent installation (developer mode)

For development and testing without repackaging after every change:

1. Navigate to `about:debugging` in Thunderbird.
2. Click **This Thunderbird**.
3. Click **Load Temporary Add-on…**.
4. Select `src/manifest.json` from the cloned repository.

The extension will be active until Thunderbird restarts.

---

## CI / CD

Every pull request and push to `main` triggers the **Build and Release** workflow (`.github/workflows/build.yml`):

1. **Validate** – checks that `manifest.json` is well-formed and contains all required fields.
2. **Package** – zips the `src/` directory into a `.xpi` file.
3. **Upload artifact** – attaches the `.xpi` to the workflow run for inspection.
4. **Publish release** *(main branch only)* – creates (or replaces) a GitHub Release tagged `v<version>` with the `.xpi` as the downloadable binary.

---

## Contributing

Pull requests are welcome.  To run the development version, see **Option C** above.

Please keep the `version` field in `src/manifest.json` updated for any release you intend to ship — the CI pipeline derives the release tag from it.

---

## License

[Apache-2.0](LICENSE)
