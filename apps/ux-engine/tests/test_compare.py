#!/usr/bin/env python3
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

from PIL import Image

TOOL = pathlib.Path(__file__).resolve().parents[1] / "bin/ux-compare"


class CompareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.make_image("reference.png", (32, 24), "red")
        self.make_image("candidate.png", (32, 24), "blue")
        self.points = [self.point("hero"), self.point("detail")]

    def make_image(self, name, size, color):
        image = Image.new("RGB", size, color)
        image.putpixel((0, 0), (255, 255, 255))
        image.save(self.root / name)

    def point(self, ident):
        return {"id": ident, "label": ident, "viewport": {"width": 32, "height": 24},
                "reference": {"path": "reference.png", "scroll_y": 100},
                "candidate": {"path": "candidate.png", "scroll_y": 230}}

    def run_tool(self, *options):
        manifest = self.root / "manifest.json"
        manifest.write_text(json.dumps({"checkpoints": self.points}))
        return subprocess.run([sys.executable, str(TOOL), str(manifest), "--out", str(self.root / "compare.html"), *options], capture_output=True, text=True)

    def payload(self):
        page = (self.root / "compare.html").read_text()
        data = json.loads(re.search(r'<script id="comparison-data" type="application/json">(.*?)</script>', page, re.S)[1])
        return page, data

    def test_embeds_pairs_and_preserves_matched_scene_metadata(self):
        result = self.run_tool()
        self.assertEqual(result.returncode, 0, result.stderr)
        page, data = self.payload()
        self.assertEqual([p["id"] for p in data["checkpoints"]], ["hero", "detail"])
        first = data["checkpoints"][0]["pair"]
        self.assertNotEqual(first[0]["image"], first[1]["image"])
        self.assertEqual([p["metadata"]["scroll_y"] for p in first], [100, 230])
        self.assertEqual(page.count("data:image/png;base64,"), 4)
        self.assertNotRegex(page, r'(?:src|href)=[\"\'](?:https?:|//)')
        self.assertNotIn("fetch(", page)
        self.assertIn("ArrowLeft", page)
        self.assertIn('id="opacity"', page)

    @unittest.skipUnless(shutil.which("osascript"), "JavaScriptCore via osascript unavailable")
    def test_decoding_is_atomic_and_metadata_has_real_newlines(self):
        self.assertEqual(self.run_tool().returncode, 0)
        page, data = self.payload()
        script = re.findall(r'<script>(.*?)</script>', page, re.S)[0]
        harness = r'''
const elements={},pending=[];
function element(id){return {id,style:{},value:id==='opacity'?'50':'0',textContent:'',
 addEventListener(){},replaceWith(image){elements[id]=image}}}
const document={getElementById(id){return elements[id]||(elements[id]=element(id))},
 addEventListener(){},body:{classList:{toggle(){}}}};
document.getElementById('comparison-data').textContent=JSON.stringify(FIXTURE);
const Image=function(){Object.assign(this,element(''));this.decode=()=>({});this.replaceWith=function(image){elements[this.id]=image}};
const Promise={all(images){return {then(callback){pending.push(callback);return {catch(){}}}}}};
function assert(value,message){if(!value)throw new Error(message)}
'''.replace("FIXTURE", json.dumps(data))
        checks = r'''
assert(byId('scene').textContent==='', 'heading changed before decode');
pending.shift()();
assert(byId('scene').textContent==='hero (1 / 2)', 'first scene missing');
assert(!byId('meta').textContent.includes(String.fromCharCode(92)+'n'), 'metadata contains literal backslash-n');
assert(byId('meta').textContent.split(String.fromCharCode(10)).length===3, 'metadata must have three real lines');
const oldLeft=byId('left'),oldRight=byId('right');
byId('checkpoint').value=1;show();
assert(byId('left')===oldLeft&&byId('right')===oldRight, 'pair changed before both decoded');
assert(byId('scene').textContent==='hero (1 / 2)', 'heading changed before pair');
byId('checkpoint').value=0;show();
pending.shift()();
assert(byId('left')===oldLeft&&byId('right')===oldRight, 'superseded decode committed');
pending.shift()();
assert(byId('left')!==oldLeft&&byId('right')!==oldRight, 'decoded pair not committed');
byId('checkpoint').value=1;show();pending.shift()();
assert(byId('scene').textContent==='detail (2 / 2)', 'latest scene missing');
'''
        result = subprocess.run(["osascript", "-l", "JavaScript", "-e",
                                 'function run(argv) { new Function(argv[0])(); return "OK"; }',
                                 harness + script + checks], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_mismatched_dimensions(self):
        self.make_image("candidate.png", (33, 24), "blue")
        result = self.run_tool()
        self.assertEqual(result.returncode, 2)
        self.assertIn("dimensions", result.stderr)
        self.assertFalse((self.root / "compare.html").exists())

    def test_rejects_wrong_declared_viewport(self):
        self.points[0]["viewport"]["height"] = 25
        self.assertEqual(self.run_tool().returncode, 2)

    def test_rejects_missing_pair(self):
        del self.points[0]["candidate"]
        self.assertEqual(self.run_tool().returncode, 2)

    def test_rejects_missing_empty_nonimage_and_uniform_files(self):
        for content in (None, b"", b"this is not an image"):
            path = self.root / "candidate.png"
            path.unlink(missing_ok=True)
            if content is not None:
                path.write_bytes(content)
            self.assertEqual(self.run_tool().returncode, 2)
        Image.new("RGB", (32, 24), "white").save(path)
        self.assertEqual(self.run_tool().returncode, 2)

    def test_blind_omits_identity_paths_and_metadata(self):
        self.assertEqual(self.run_tool("--blind").returncode, 0)
        page, data = self.payload()
        self.assertEqual(data["labels"], ["A", "B"])
        self.assertNotIn("reference.png", page)
        self.assertNotIn("candidate.png", page)
        self.assertNotIn("scroll_y", page)
        self.assertEqual(data["checkpoints"][0]["pair"], data["checkpoints"][1]["pair"])

    def test_labels_cannot_break_out_of_script(self):
        self.points[0]["label"] = '</script><script>alert("oops")</script>'
        self.assertEqual(self.run_tool().returncode, 0)
        page, data = self.payload()
        self.assertNotIn(self.points[0]["label"], page)
        self.assertEqual(data["checkpoints"][0]["label"], self.points[0]["label"])


if __name__ == "__main__":
    unittest.main()
