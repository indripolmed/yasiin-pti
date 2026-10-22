import subprocess, sys, time, uno
from com.sun.star.beans import PropertyValue

src, out_docx, out_pdf = sys.argv[1:4]
proc = subprocess.Popen(["soffice", "--headless", "--invisible", "--norestore",
    "--accept=socket,host=localhost,port=2002;urp;", f"-env:UserInstallation=file:///tmp/lo_profile_manual"])
ctx = uno.getComponentContext()
resolver = ctx.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", ctx)
for _ in range(60):
    try:
        rctx = resolver.resolve("uno:socket,host=localhost,port=2002;urp;StarOffice.ComponentContext"); break
    except Exception:
        time.sleep(1)
desktop = rctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", rctx)
def pv(n, v):
    p = PropertyValue(); p.Name = n; p.Value = v; return p
doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(src), "_blank", 0, (pv("Hidden", True),))
idx = doc.getDocumentIndexes()
for i in range(idx.getCount()):
    idx.getByIndex(i).update()
doc.refresh()
for i in range(idx.getCount()):   # ulangi: nomor halaman bisa bergeser setelah daftar isi terisi
    idx.getByIndex(i).update()
doc.storeToURL(uno.systemPathToFileUrl(out_docx), (pv("FilterName", "MS Word 2007 XML"),))
doc.storeToURL(uno.systemPathToFileUrl(out_pdf), (pv("FilterName", "writer_pdf_Export"),))
doc.close(True)
try: desktop.terminate()
except Exception: pass
proc.wait(timeout=30)
print("done")
