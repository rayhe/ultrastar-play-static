"""Browser UI/integration tests. Python Playwright is optional, never a runtime dependency.

Normal mode uses the actual static server and Chromium's fake microphone stream.
--isolated renders local code into about:blank without navigation, for environments
whose managed browser policy forbids URL navigation. This tests DOM/control logic
and canvas rendering but DOES NOT validate origin storage, service workers,
module loading over HTTP, or real microphone acquisition. No policies are changed.
"""
from __future__ import annotations
import argparse, hashlib, json, math, os, re, struct, tempfile, wave, zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('TEST_OUTPUT_DIR', ROOT / 'test-results'))
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5173/')
BROWSER = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')

def bundle_for_isolated_test() -> str:
    """Concatenate our restricted named-export modules into isolated namespaces.
    This transformation is used ONLY in this test harness, never in dist/.
    """
    chunks = ['window.__testModules = {};']
    order = ['song','pitch','scoring','zip','library','demo','microphone','renderer','app']
    for name in order:
        text = (ROOT / 'src' / f'{name}.js').read_text()
        exports = re.findall(r'^export\s+(?:async\s+)?(?:function|class|const)\s+(\w+)', text, re.M)
        text = re.sub(r"import\s*\{([^}]+)\}\s*from\s*['\"]\./([^'\"]+)\.js['\"];?", lambda m: f"const {{{m[1]}}} = window.__testModules[{json.dumps(m[2])}];", text)
        text = re.sub(r'^export\s+', '', text, flags=re.M)
        text = text.replace('import.meta.url', json.dumps(f'https://ultrastar.invalid/src/{name}.js'))
        chunks.append(f'window.__testModules[{json.dumps(name)}] = (() => {{\n{text}\nreturn {{{",".join(exports)}}};\n}})();')
    return '\n'.join(chunks)

def isolated_load(page):
    html = (ROOT / 'index.html').read_text()
    html = re.sub(r'<script[^>]*src=[^>]*>\s*</script>', '', html)
    html = re.sub(r'<link\b[^>]*>', '', html)
    page.set_content(html)
    page.add_style_tag(content=(ROOT/'style.css').read_text())
    page.expose_function('__testDigest', lambda data: list(hashlib.sha256(bytes(data)).digest()))
    page.evaluate("""() => {
      // Explicit test doubles for capabilities unavailable to an opaque origin.
      const store = new Map();
      Object.defineProperty(window, 'localStorage', {value: {
        getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,String(v)),
        removeItem: k => store.delete(k), clear: () => store.clear()
      }});
      if (!crypto.subtle) Object.defineProperty(crypto, 'subtle', {value: {
        digest: async (_, bytes) => new Uint8Array(await window.__testDigest(Array.from(bytes))).buffer
      }});
      window.fetch = async () => new Response('{"songs":[]}', {headers:{'Content-Type':'application/json'}});
    }""")
    page.add_script_tag(content=bundle_for_isolated_test())

def fixtures(directory: Path):
    rate = 48000
    wav = directory / 'a4.wav'
    samples = b''.join(struct.pack('<h', int(11000*math.sin(2*math.pi*440*i/rate))) for i in range(rate*7))
    with wave.open(str(wav),'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(rate); f.writeframes(samples)
    chart = '#TITLE:Integration A4\n#ARTIST:Test fixture\n#BPM:120\n#GAP:1000\n#AUDIO:a4.wav\n: 0 16 9 Sing \n* 16 16 9 steadily\nE\n'
    txt = directory / 'a4.txt'; txt.write_text(chart)
    archive = directory / 'test.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('Fixture/a4.txt', chart.replace('Integration A4','ZIP A4')); z.write(wav,'Fixture/a4.wav')
    return txt, wav, archive

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--isolated',action='store_true');args=parser.parse_args()
    results={'mode':'isolated DOM harness' if args.isolated else 'HTTP browser integration','passed':[], 'skipped':[], 'page_errors':[]}
    def passed(name): results['passed'].append(name); print('PASS', name, flush=True)
    with tempfile.TemporaryDirectory() as temp, sync_playwright() as pw:
        txt,wav,archive=fixtures(Path(temp))
        launch_args=['--no-sandbox','--autoplay-policy=no-user-gesture-required']
        if not args.isolated: launch_args += ['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream', f'--use-file-for-fake-audio-capture={wav}']
        browser=pw.chromium.launch(executable_path=BROWSER,headless=True,args=launch_args)
        results['browser']=browser.version
        context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
        page=context.new_page();page.set_default_timeout(12000)
        page.on('pageerror', lambda error: results['page_errors'].append(str(error)))
        if args.isolated: isolated_load(page)
        else: page.goto(BASE,wait_until='networkidle')
        expect(page.locator('.song-card')).to_have_count(1)
        expect(page.locator('body')).to_contain_text('Find Your Voice')
        page.screenshot(path=str(OUT/'library.png'),full_page=True)
        passed('library boots and renders original demo')
        page.locator('#search').fill('no match here');expect(page.locator('#emptyState')).to_be_visible()
        page.locator('#search').fill('voice');expect(page.locator('.song-card')).to_have_count(1)
        page.locator('#search').fill('');passed('search and empty state')
        page.locator('.favorite-button').click();page.select_option('#libraryFilter','favorites');expect(page.locator('.song-card')).to_have_count(1)
        page.select_option('#libraryFilter','all');page.locator('.queue-add').click();expect(page.locator('#queueCount')).to_have_text('1');passed('favorites and queue controls')
        page.locator('.card-footer button').click();before=page.input_value('#chartText');page.click('#gapLater');assert '#GAP:2100' in page.input_value('#chartText')
        page.click('#pitchUp');expect(page.locator('#editorStatus')).to_contain_text('Valid')
        page.fill('#chartText','#BPM:0');page.click('#validateChart');expect(page.locator('#editorStatus')).to_have_class(re.compile('error'))
        page.fill('#chartText',before);page.click('#saveChart');expect(page.locator('#editorDialog')).not_to_be_visible();passed('chart editor validates, shifts timing/pitch, applies changes')
        page.locator('#filesInput').set_input_files([str(txt),str(wav)]);expect(page.locator('.song-card')).to_have_count(2)
        expect(page.get_by_role('button',name='Sing Integration A4',exact=True)).to_be_enabled();passed('local TXT and WAV import with media matching')
        page.locator('#filesInput').set_input_files(str(archive));expect(page.locator('.song-card')).to_have_count(3);passed('native deflate ZIP import with nested paths')
        page.screenshot(path=str(OUT/'library-imports.png'),full_page=True)
        page.get_by_role('button',name='Sing Integration A4',exact=True).click();page.click('#optionsRehearse')
        expect(page.locator('#stageView')).to_be_visible()
        # Managed URL policies may block even blob media; distinguish this from a product defect.
        if args.isolated:
            # The real HTMLMediaElement may be blocked by the sandbox's URLBlocklist.
            # No network permissions or policies are changed. If blocked, inject only
            # a deterministic test media clock to verify stage control/renderer logic.
            page.wait_for_timeout(800)
            if page.locator('#startButton').is_disabled():
                page.evaluate("""() => {const a=document.getElementById('songAudio');
                  const state={time:0,paused:true};
                  Object.defineProperty(a,'duration',{configurable:true,get:()=>7});
                  Object.defineProperty(a,'readyState',{configurable:true,get:()=>4});
                  Object.defineProperty(a,'currentTime',{configurable:true,get:()=>state.time,set:v=>state.time=v});
                  Object.defineProperty(a,'paused',{configurable:true,get:()=>state.paused});
                  a.play=async()=>{state.paused=false;a.dispatchEvent(new Event('playing'));};
                  a.pause=()=>{state.paused=true;};
                  a.load=()=>{setTimeout(()=>a.dispatchEvent(new Event('loadedmetadata')),0);};
                  window.__testMedia=state;
                  setInterval(()=>{if(!state.paused){state.time+=.025*a.playbackRate;if(state.time>=7){state.paused=true;a.dispatchEvent(new Event('ended'));}}},25);
                }""")
                # Retry preparation to attach a fresh metadata listener.
                page.click('#backButton');page.get_by_role('button',name='Sing Integration A4',exact=True).click();page.click('#optionsRehearse')
                results['skipped'].append('actual media playback; managed browser blocks blob URLs, media-clock test double used')
        expect(page.locator('#startButton')).to_be_enabled();page.click('#startButton');page.wait_for_timeout(1600)
        t=page.eval_on_selector('#songAudio','a=>a.currentTime');assert t>1, t
        page.click('#pauseButton');paused=page.eval_on_selector('#songAudio','a=>a.currentTime');page.wait_for_timeout(300)
        assert abs(page.eval_on_selector('#songAudio','a=>a.currentTime')-paused)<.08
        page.click('#startButton');page.wait_for_timeout(300);page.screenshot(path=str(OUT/'stage.png'),full_page=True)
        expect(page.locator('#lyrics')).to_contain_text('Sing');passed('rehearsal stage, lyrics, canvas, pause/resume controls')
        page.locator('#seek').evaluate("e=>{e.value=6.5;e.dispatchEvent(new Event('input',{bubbles:true}));}")
        expect(page.locator('#resultsDialog')).to_be_visible();expect(page.locator('#resultsNote')).to_contain_text('No microphone score')
        passed('rehearsal results do not fabricate microphone scores');page.click('#resultsHome')
        page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'mobile.png'),full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        passed('mobile library has no horizontal overflow')
        page.set_viewport_size({'width':1440,'height':1000})
        page.click('#soundcheckButton');page.click('#connect1')
        if args.isolated:
            expect(page.locator('#micError')).to_contain_text('requires HTTPS')
            passed('microphone-unavailable error is explicit')
            results['skipped'] += ['live getUserMedia / AudioWorklet device acquisition','origin IndexedDB persistence and service-worker offline loading','HTTP ES module delivery and production security headers','physical dual microphones and non-Chromium browsers']
        else:
            page.wait_for_function("document.getElementById('pitch1').textContent.includes('A4')",timeout=15000)
            passed('fake microphone traverses AudioWorklet, Worker, pitch display')
            page.click('#settingsDone');page.get_by_role('button',name='Sing Integration A4',exact=True).click();page.click('#optionsSing');expect(page.locator('#startButton')).to_be_enabled();page.click('#startButton');expect(page.locator('#resultsDialog')).to_be_visible(timeout=15000)
            number=int(page.locator('.result-number').inner_text());assert number>7500,number;results['synthetic_microphone_score']=number;passed('synthetic A4 microphone earns a real computed score')
        assert not results['page_errors'], results['page_errors']
        passed('no uncaught page JavaScript exceptions')
        browser.close()
    (OUT/'browser-results.json').write_text(json.dumps(results,indent=2))
    print(json.dumps(results,indent=2))

if __name__=='__main__': main()
