# Pizza Pia Print Bridge

Kasa bilgisayarında çalışan localhost servis — web admin'den HTTP POST ile
gelen sipariş JSON'unu ESC/POS komutlarıyla termal yazıcıya gönderir.

> **Not:** Bu paket ana Next.js build'ine **dahil değildir**. Bağımsız bir
> Node.js servisidir; sadece kasa PC'sine deploy edilir.

## Geliştirme (lokal)

```bash
cd print-bridge
npm install
cp .env.example .env
# .env'yi düzenle (PRINTER_INTERFACE, vb.)
npm run dev
```

Test fişi:

```bash
npm run test:print
```

## Production build (Windows .exe)

```bash
npm run build
npm run package:win
# → bin/pizza-pia-print-bridge.exe
```

`.exe` ve `.env` dosyalarını kasa PC'sine `C:\Program Files\PizzaPiaBridge\`
altına kopyala.

## Windows servisi olarak kurma (`nssm` ile)

1. [nssm](https://nssm.cc/) indir, `C:\Program Files\nssm\nssm.exe` altına koy.
2. PowerShell'i yönetici olarak aç:

```powershell
& "C:\Program Files\nssm\nssm.exe" install PizzaPiaBridge "C:\Program Files\PizzaPiaBridge\pizza-pia-print-bridge.exe"
& "C:\Program Files\nssm\nssm.exe" set PizzaPiaBridge AppDirectory "C:\Program Files\PizzaPiaBridge"
& "C:\Program Files\nssm\nssm.exe" set PizzaPiaBridge Start SERVICE_AUTO_START
& "C:\Program Files\nssm\nssm.exe" start PizzaPiaBridge
```

3. Doğrulama:

```powershell
curl http://localhost:9100/health
```

## Yazıcı kurulumu

1. USB ile bağla.
2. Üreticinin Windows driver'ını kur.
3. **Default printer** olarak ayarla (Ayarlar → Bluetooth ve cihazlar → Yazıcılar).
4. Yazıcının kâğıt yan tuşuna basılı tutarak aç → self-test fişi yazdırır,
   bağlantıyı doğrular.

## Sorun giderme

| Belirti | Olası neden |
|---|---|
| `/health` 503 dönüyor | Yazıcı kapalı, kâğıt yok, USB kablo gevşek |
| `PRINTER_OFFLINE` hatası | Aynı |
| CORS hatası tarayıcıda | `.env` `ALLOWED_ORIGINS` listesine production URL'i eklenmemiş |
| Türkçe karakter `?` çıkıyor | Yazıcı code page'i yanlış. `printer.ts`'deki `CharacterSet.WPC1254_TURKISH` doğru olmalı; yazıcı modeline göre `SLOVENIA` veya `LATIN2` denenebilir |
| Fiş kesilmiyor | Yazıcı manuel cut'lı model olabilir; `printer.cut()` partial cut komutu gönderir, manuel kesim gerekiyorsa modelin auto-cutter olması gerekir |

## Mimari

Detay için: `../docs/PRINTER.md`
