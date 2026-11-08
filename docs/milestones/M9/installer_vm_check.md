# M9: installer check on a clean Windows 11 VM

The PRD asks for the installer to install and run on a clean Windows 11 VM.
`pnpm test:installer` runs the same steps automatically on the build machine
(silent install into a temporary folder, start, uninstall). Only this VM step
is manual. You need a VM because Windows 11 Home has no Windows Sandbox or
Hyper-V.

## Steps

1. Build the installer on the build machine: `pnpm build:installer`. It writes
   `app/build/bin/PS2CC-amd64-installer.exe`.
2. Take a fresh Windows 11 VM (Hyper-V, VirtualBox or VMware; a VM made from
   Microsoft's Windows 11 development environment image is enough). It needs
   no network.
3. Copy `PS2CC-amd64-installer.exe` into the VM and run it. Expect:
   - no administrator prompt (it installs for the current user);
   - an install folder of `%LOCALAPPDATA%\Programs\PS2CC`;
   - a final page with "Start PS2CC".
4. Start PS2CC from the final page or from the Start menu. Expect:
   - the "Welcome to PS2CC" first-run setup (choose Skip for now if the VM
     has no Unity);
   - the default character in the viewport;
   - `Textures`, `Bones 53` and `Blendshapes 15` in the budget bar.
5. Change a slider and press Ctrl+S. The character is saved to
   `Documents\PS2CC\Characters\Untitled\`. File → Characters… shows it with a
   thumbnail.
6. Close PS2CC and uninstall it from Settings → Apps. Expect:
   - `%LOCALAPPDATA%\Programs\PS2CC` is gone;
   - `Documents\PS2CC` (your characters) is still there.

Windows 11 ships the WebView2 runtime. If a VM has had it removed, the
installer runs Microsoft's WebView2 bootstrapper, which needs the network.
That is the only network use, and only at install time.

Tell me the result. If something fails, send a screenshot and
`%LOCALAPPDATA%\PS2CC\logs\ps2cc-<date>.log`.
