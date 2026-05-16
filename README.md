# Eurovision Party Scoreboard

A live Eurovision-style party scoreboard for collecting juror rankings, revealing points, and keeping a real-time tally.

## Requirements

- Node.js 20 or newer
- Everyone using the locally hosted mode must be on the same local network as the host computer.

## Install Node.js

If `npm start` does not work, install Node.js first.

### Windows

Option 1: Download the LTS installer from:

```text
https://nodejs.org/
```

Run the installer, accept the defaults, then close and reopen PowerShell.

Option 2: If you use `winget`, open PowerShell and run:

```powershell
winget install OpenJS.NodeJS.LTS
```

Check that Node and npm are installed:

```powershell
node --version
npm --version
```

### macOS

Option 1: Download the LTS installer from:

```text
https://nodejs.org/
```

Run the installer, then close and reopen Terminal.

Option 2: If you use Homebrew, run:

```bash
brew install node
```

Check that Node and npm are installed:

```bash
node --version
npm --version
```

## Run Locally

From this project folder:

```powershell
npm start
```

The host can open:

```text
http://localhost:4173
```

The app stores party data in `data/parties/`. That folder is ignored by git.

## Run From VS Code

This is often the easiest option if you are not comfortable using a standalone terminal.

1. Install Visual Studio Code from:

```text
https://code.visualstudio.com/
```

2. Open VS Code.
3. Choose `File -> Open Folder...`.
4. Select the project folder.
5. Open the Run and Debug view from the left sidebar.
6. Choose `Start Eurovision Scoreboard` from the run configuration dropdown.
7. Click the green play button.
8. Open this address in a browser on the host computer:

```text
http://localhost:4173
```

If VS Code says `node` is not recognized, install Node.js using the instructions above, then close and reopen VS Code.

Keep VS Code open while guests are voting. To stop the app, use the red stop button in the Run and Debug toolbar.

## Host A Local Watch Party

1. Start the app on the host computer.
2. Open `http://localhost:4173` on the host computer.
3. Go to `Host` and claim host access.
4. Go to `Settings`.
5. Optional: open `Edit Entries` to choose or edit the songs before anyone votes.
6. Share the invite link or QR code shown in Settings with guests.

Settings also shows a QR code for the selected invite link. Guests can scan it with their phone camera instead of typing the address.

If the app is opened on `localhost`, the Settings invite field tries to show a local-network IP link such as:

```text
http://192.168.1.23:4173/?party=local
```

Guests on other devices cannot use `localhost`, because `localhost` means "this same device." They need the host computer's local IP address.

Some computers have multiple network adapters, so the app may find more than one possible local address. The address for your active Wi-Fi or Ethernet network is usually the one that starts with `192.168.x.x`, `10.x.x.x`, or `172.16.x.x` through `172.31.x.x`. If one link does not work, try the other local addresses.

## Guest Voting

Guests do not need host access.

1. Open the invite link or scan the QR code.
2. Stay on the `Submit` tab.
3. Enter a jury name.
4. Pick exactly 10 different entries in order.
5. Click `Send Ranking`.

The first choice receives 12 points, then 10, 8, 7, 6, 5, 4, 3, 2, and 1 point.

Guests can reopen the same link on the same device and edit their own ranking until the host starts presenting that ballot. Once the host starts revealing a guest's ballot, that ballot is locked.

## Host Presenting

Use the host computer or another unlocked host device for presentation.

1. Open the party link.
2. Go to `Host`.
3. Click `Claim Host`, or enter the host password if one has been set.
4. Optional: click `Hide Panel` on the scoreboard screen for presentation mode.
5. In the jury queue, click `Start` for the ballot you want to present.
6. Reveal points with the point buttons:
   - `Reveal 1` reveals the next point value.
   - `Reveal 7`, `Reveal 8`, `Reveal 10`, and `Reveal 12` can reveal through those point tiers.
7. When a jury is complete, click `Clear Reveal`.
8. Repeat for each jury.
9. After every submitted jury is applied, click `Show Winner`.

The scoreboard updates live for everyone connected to the party. Host-only actions are disabled until host access is unlocked.

## Edit Entries

Hosts should edit entries before guests start voting.

1. Go to `Settings`.
2. Click `Edit Entries`.
3. Claim host access if the editor is locked.
4. Choose a saved list, such as `2026 Grand Final` or `2025 Grand Final`, and click `Load List`.
5. Edit countries, artists, and songs in the separate fields.
6. Click `Apply to Party` to use the edited entries for the current party.
7. Click `Save List` if you also want to keep the edited rows as a reusable list.

Applying or loading an entry list resets voting for that party.

## Find Your Local IP Address

### Windows

Open PowerShell and run:

```powershell
ipconfig
```

Look for the active Wi-Fi or Ethernet adapter and copy the `IPv4 Address`, for example:

```text
192.168.1.23
```

Then guests should visit:

```text
http://192.168.1.23:4173/?party=local
```

### macOS

Open Terminal and run:

```bash
ipconfig getifaddr en0
```

If that prints nothing and you are using Ethernet, try:

```bash
ipconfig getifaddr en1
```

You can also find it in `System Settings -> Network -> Wi-Fi` or `Ethernet`.

Then guests should visit:

```text
http://YOUR-IP:4173/?party=local
```

## Network Caveats

- Guests must be on the same Wi-Fi or wired network as the host computer.
- Some guest networks block devices from talking to each other. If guests cannot connect, try a non-guest Wi-Fi network or a hotspot.
- The host computer's firewall may ask whether Node.js can accept incoming connections. Allow it for the local/private network.
- VPNs can interfere with local connections. Turning off the VPN may help.
- The host computer must stay awake and keep the app running while guests vote.

## Parties And Entries

The default local party is:

```text
local
```

You can create additional parties in `Settings`. Each party has its own:

- entries
- submitted ballots
- scoreboard totals
- host lock state

Saved entry lists live in:

```text
entries/
```

The default starter lineup is `entries/2026.tsv`. Use the `Edit Entries` link in Settings to open the dedicated entry editor page. It can load another saved list, edit entries with separate country/artist/song fields, apply the edited entries to the current party, or save the edited rows as a reusable list.

After a party edits or loads entries, voting for that party is reset.

## Host Locking

Host controls are locked so guests cannot reveal points or reset the scoreboard.

The host can:

- claim host access on the host device
- set a host password
- unlock host controls from another browser by entering that password

Guest devices can submit and edit their own ballot until the host starts presenting that ballot.

## Public Hosting Notes

The app has party IDs and host locking so it can be deployed publicly later. For a real public deployment, use HTTPS and persistent storage/backups. The current version uses local JSON files, which is fine for local hosting and simple demos but not ideal as the only storage for a production public service.
