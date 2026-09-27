#!/bin/bash
# qr must round-trip a real QR, refuse an image with none, and report a
# texted image that was never downloaded instead of silently finding nothing.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
swift - "$T" <<'SWIFT' || exit 1
import CoreImage
import AppKit
let dir = CommandLine.arguments[1]
let f = CIFilter(name: "CIQRCodeGenerator")!
f.setValue("https://example.com/packet".data(using: .utf8), forKey: "inputMessage")
let img = f.outputImage!.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
let rep = NSCIImageRep(ciImage: img); let ns = NSImage(size: rep.size); ns.addRepresentation(rep)
let bmp = NSBitmapImageRep(data: ns.tiffRepresentation!)!
try! bmp.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: dir + "/qr.png"))
let blank = NSImage(size: NSSize(width: 200, height: 200)); blank.lockFocus(); NSColor.white.set()
NSRect(x: 0, y: 0, width: 200, height: 200).fill(); blank.unlockFocus()
let b2 = NSBitmapImageRep(data: blank.tiffRepresentation!)!
try! b2.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: dir + "/blank.png"))
SWIFT
[ "$("$ROOT/bin/qr" "$T/qr.png")" = "https://example.com/packet" ] || { echo "round trip failed"; fail=1; }
"$ROOT/bin/qr" "$T/blank.png" >/dev/null 2>&1 && { echo "blank image should exit 1"; fail=1; }
# A chat.db whose only image was never downloaded (transfer_state 0).
sqlite3 "$T/chat.db" "CREATE TABLE handle(ROWID INTEGER PRIMARY KEY,id TEXT);
 CREATE TABLE message(ROWID INTEGER PRIMARY KEY,handle_id INT,is_from_me INT,date INT);
 CREATE TABLE message_attachment_join(message_id INT,attachment_id INT);
 CREATE TABLE attachment(ROWID INTEGER PRIMARY KEY,transfer_state INT,filename TEXT,mime_type TEXT);
 INSERT INTO handle VALUES(1,'+15550001111'); INSERT INTO message VALUES(1,1,0,1);
 INSERT INTO message_attachment_join VALUES(1,1);
 INSERT INTO attachment VALUES(1,0,'/nonexistent/IMG_0606.heic','image/heic');"
err=$(CHAT_DB="$T/chat.db" QR_NO_OPEN=1 "$ROOT/bin/qr" --from +15550001111 2>&1 >/dev/null)
echo "$err" | grep -q "not downloaded: IMG_0606.heic" || { echo "undownloaded image not reported: $err"; fail=1; }
exit $fail
