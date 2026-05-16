# Eurovision Party Scoreboard

A live Eurovision-style party scoreboard for collecting juror rankings, revealing points, and keeping a real-time tally.

## Requirements

- Node.js 20 or newer
- For local hosting, guests must be on the same local network as the host computer.

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

Opening the app with no saved party now shows a start screen where you can create a new party or join an existing one with a 6-character party code.

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

## Create Or Join A Party

When you open the app without a party link, choose one of these options:

- `Create Party` starts a new scoreboard and gives it a 6-character party code.
- `Join Party` opens an existing scoreboard when you enter its party code.
- A join password is optional when creating a party. Guests only need it the first time they join from a device.

The party code is also in the party link, for example:

```text
http://localhost:4173/?party=ABC234
```

Old local links such as `?party=local` still work.

## Host A Watch Party

1. Start the app or open the deployed site.
2. Create a party from the start screen.
3. Go to `Host` and claim host access.
4. Go to `Settings`.
5. Optional: open `Edit Entries` to choose or edit the songs before anyone votes.
6. Share the invite link, QR code, or party code shown in Settings with guests.

Settings also shows a QR code for the selected invite link. Guests can scan it with their phone camera instead of typing the address.

If the app is opened on `localhost`, the Settings invite field tries to show a local-network IP link such as:

```text
http://192.168.1.23:4173/?party=local
```

Guests on other devices cannot use `localhost`, because `localhost` means "this same device." They need the host computer's local IP address.

Some computers have multiple network adapters, so the app may find more than one possible local address. The address for your active Wi-Fi or Ethernet network is usually the one that starts with `192.168.x.x`, `10.x.x.x`, or `172.16.x.x` through `172.31.x.x`. If one link does not work, try the other local addresses.

## Guest Voting

Guests do not need host access.

1. Open the invite link, scan the QR code, or enter the party code on the start screen.
2. Enter the join password if the host set one.
3. Stay on the `Submit` tab.
4. Enter a jury name.
5. Pick exactly 10 different entries in order.
6. Click `Send Ranking`.

The first choice receives 12 points, then 10, 8, 7, 6, 5, 4, 3, 2, and 1 point.

Guests can reopen the same link on the same device and edit their own ranking until the host starts presenting that ballot. Once the host starts revealing a guest's ballot, that ballot is locked.

If the host has clicked `Stop Voting`, guests will see that voting is closed and cannot submit changes.

One device can submit multiple ballots. Use the `Saved ballots on this device` dropdown and `New Ballot` button above the form to switch between or create additional ballots. Each ballot gets its own jury name and ranking.

## Host Presenting

Use the host computer or another unlocked host device for presentation.

1. Open the party link.
2. Go to `Host`.
3. Click `Claim Host`, or enter the host password if one has been set.
4. Voting is open by default. If you need to re-open voting after stopping it, click `Start Voting`. The scoreboard banner will show `START VOTING NOW`.
5. For a rehearsal or demo, click `Add Practice Ballots` to create five random test juries.
6. Click `Stop Voting` when submissions should close. The scoreboard banner will show `STOP VOTING NOW`, and guests can no longer submit or edit ballots.
7. Optional: click `Hide Panel` on the scoreboard screen for presentation mode.
8. In the jury queue, click `Start` for the ballot you want to present.
9. Reveal points from lowest to highest to build tension:
   - `Reveal 1` awards 1 point and advances to the next rank.
   - `Reveal 7`, `Reveal 8`, `Reveal 10`, and `Reveal 12` award all remaining points up through that tier in one click.
10. When a jury is complete, click `Clear Reveal`. Alternatively, click `Next Jury` to finish the current jury and start the next pending one in a single action.
11. Repeat for each jury.
12. After every submitted jury is applied, click `Show Winner`.

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

The default local party is still available for old links and quick local tests:

```text
local
```

New parties created from the start screen use 6-character codes. Each party has its own:

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

The app is now designed around party codes for public deployment. For a real public deployment, use HTTPS and persistent storage/backups. The current version uses local JSON files, which is fine for local hosting and simple demos but not ideal as the only storage for a production public service.
