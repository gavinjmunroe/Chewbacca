# LockDown Browser and remote management

`chewbacca lockdown install` installs a local macOS background service with one
administrator approval. It works with every agent app closed and makes no model,
network, or API calls. `chewbacca lockdown status` reports its installation state.

When LockDown Browser starts, the service uses Apple's `kickstart` tool to stop
Remote Management. After the browser exits, including a crash, it restores the
original state and checks Apple's screen and control permission status. A recovery
record survives watcher crashes and computer restarts. An originally disabled
Remote Management service stays disabled. Existing access lists are preserved.

Installation requires Remote Management to be enabled with screen and control
permissions already granted. Apple does not let `kickstart` grant those permissions
on modern macOS. The installer refuses an incomplete baseline.

`chewbacca lockdown open` pauses ARD and verifies it stopped before opening the
browser. Use that launcher to avoid a race with the browser's initial checks.
Direct launches are also detected once per second; a browser that checks ARD
sooner may show its warning and need another launch through the command above.
No exam controls are modified. Other prohibited apps and sharing services may
still need to close according to the browser's own prompts.

After installing, turn on Full Disk Access for
`/Library/Application Support/LockDown ARD Switch/lockdown-ard-switch`. Without it
kickstart can neither remove nor write `RemoteManagement.launchd`, the log says
"Apple did not deactivate Remote Management", and launchd restarts ARDAgent at
once. Adding it to the list is not enough: on 2026-10-19 it was listed with the
toggle off (TCC `auth_value` 0) and nothing worked until the switch went on.
Verified that night: open paused ARD within a second, quitting the browser
restored the file and ARDAgent came back.

`chewbacca lockdown uninstall` restores any pending state before removing only
this service. Close LockDown Browser before uninstalling.

Sources: [Apple Remote Desktop setup](https://support.apple.com/en-qa/guide/remote-desktop/apd8b1c65bd/mac)
and [Respondus ARD warning](https://support.respondus.com/hc/en-us/articles/4409604095515-I-need-to-close-Apple-VNC-Server-and-or-ARD-Agent).
