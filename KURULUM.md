# YKS Macera Defteri — Kurulum

Toplam süre: yaklaşık 20–30 dakika. Hepsi ücretsiz, kredi kartı gerekmez.

Sonunda elinde şunlar olacak:
- `https://KULLANICI-ADIN.github.io/yks-macera/` gibi bir adres,
- telefona kurulan, ikonlu bir uygulama,
- görev gelince gezginin telefonuna, görev bitince görevi verenin telefonuna giden bildirimler.

---

## 1. Supabase projesi aç

1. <https://supabase.com> → **Start your project** → GitHub hesabınla giriş yap.
2. **New project** de.
   - Name: `yks-macera`
   - Database Password: güçlü bir şifre yaz ve bir yere kaydet (bu uygulamada kullanmayacağız ama Supabase istiyor).
   - Region: **Central EU (Frankfurt)** (Türkiye'ye en yakını).
3. Projenin hazırlanmasını bekle (1–2 dakika).

## 2. Anonim girişi aç

Uygulama e-posta/şifre istemiyor. Herkes isim soyismiyle giriyor; arkada otomatik bir anonim hesap açılıyor.

**Authentication → Sign In / Providers** (bazı panellerde **Authentication → Providers**) →
**Allow anonymous sign-ins** anahtarını **aç** → **Save**.

## 3. `config.js` dosyasını doldur

**Project Settings → API** (veya **Data API** / **API Keys**) sayfasından:
- **Project URL** → `SUPABASE_URL`
- **anon public** anahtarı (`eyJ...` ile başlar) → `SUPABASE_ANON_KEY`

Bu klasördeki `config.js` dosyasını aç ve bu iki değeri yapıştır.
`VAPID_PUBLIC_KEY`'i 5. adımda dolduracağız.

> `service_role` anahtarını **asla** `config.js`'e yazma. O gizli.

## 4. Veritabanını kur

**SQL Editor → New query** → `supabase/schema.sql` dosyasının **tamamını** yapıştır → **Run**.

"Success. No rows returned" görmelisin. Bu tek seferde şunları kurar:
tablolar (hesaplar, maceralar, yoldaşlar, görevler, bildirim abonelikleri), güvenlik kuralları,
canlı güncelleme ve pixel art depolama alanı.

## 5. Bildirim anahtarlarını üret

Bu klasörde bir terminal aç ve çalıştır:

```bash
node araclar/vapid-anahtar-uret.mjs
```

İki satır çıkar:
- `VAPID_PUBLIC_KEY = ...` → bunu `config.js`'teki `VAPID_PUBLIC_KEY`'e yapıştır.
- `VAPID_PRIVATE_KEY = ...` → bunu **sadece** bir sonraki adımda Supabase'e yazacaksın. Dosyaya kaydetme, GitHub'a yükleme.

## 6. Bildirim fonksiyonunu yükle

1. Supabase'de **Edge Functions → Deploy a new function → Via Editor**.
2. Fonksiyon adı: `notify-quest` (tam olarak böyle).
3. Editördeki örnek kodu sil, `supabase/functions/notify-quest/index.ts` dosyasının tamamını yapıştır → **Deploy function**.
4. **Edge Functions → Secrets** (veya **Manage secrets**) sayfasında üç gizli değer ekle:

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | 5. adımdaki public anahtar |
| `VAPID_PRIVATE_KEY` | 5. adımdaki private anahtar |
| `VAPID_SUBJECT` | `mailto:` + kendi e-postan, ör. `mailto:ad@ornek.com` |

## 7. GitHub'a yükle ve yayınla

1. <https://github.com/new> → Repository name: `yks-macera` → **Public** → **Create repository**.
   (Ücretsiz hesapta GitHub Pages için repo'nun public olması gerekiyor. İçinde gizli bir şey yok.)
2. **uploading an existing file** bağlantısına tıkla ve şunları sürükle:
   `index.html`, `app.js`, `styles.css`, `config.js`, `sw.js`, `manifest.webmanifest` ve `icons` klasörü.
   (`eski`, `supabase`, `araclar` klasörlerini yüklemene gerek yok; yüklesen de zararı yok.)
   → **Commit changes**.
3. **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main**, klasör: **/ (root)** → **Save**.
4. 1–2 dakika sonra sayfanın üstünde adresin çıkar: `https://KULLANICI-ADIN.github.io/yks-macera/`

Bir dosyayı sonradan değiştirirsen aynı yoldan tekrar yükle; GitHub üstüne yazar.

## 8. Telefona kur

**Önemli:** Kaydı (isim soyisim + gezgin/yoldaş seçimi) **kurduktan sonra, ana ekrandaki uygulamanın içinde** yap.
iPhone'da Safari ile ana ekran uygulaması ayrı hafıza kullanır; Safari'de açılan hesap uygulamaya geçmez.

**iPhone (iOS 16.4 veya daha yeni):**
1. Adresi **Safari**'de aç.
2. **Paylaş** düğmesi (kare ve yukarı ok) → **Ana Ekrana Ekle** → **Ekle**.
3. Ana ekrandaki **YKS Macera** ikonundan aç.
4. Kaydol, sonra üstteki **🔔 Bildirimleri aç**'a dokun ve izin ver.

**Android:**
1. Adresi **Chrome**'da aç.
2. Sayfadaki **Uygulamayı yükle** butonuna ya da Chrome menüsü (⋮) → **Uygulamayı yükle**'ye dokun.
3. Uygulamadan aç, kaydol, **🔔 Bildirimleri aç**'a dokun.

## 9. Dene

1. Çalışan arkadaşın **Gezgin ol** seçer ve 6 haneli kodunu alır.
2. Sen ve diğer arkadaşlar **Arkadaşa yardım** seçip bu kodu girersiniz.
3. Bir görev asın: gezginin telefonuna "⚔️ Yeni görev!" bildirimi gelir.
4. Gezgin görevi tamamlayınca görevi verenin telefonuna "✦ Görev tamamlandı!" bildirimi gelir.

---

## Bilinmesi gerekenler

- **Hesaplar cihaza bağlı.** Uygulama silinir, tarayıcı verileri temizlenir ya da telefon değişirse o cihazdaki hesap kaybolur
  ve yeniden kaydolmak gerekir. Gezgin hesabını kaybederse yeni bir macera (yeni kod) açması gerekir; eski görevler eski macerada kalır.
- **Geçit kodu bir şifre değildir.** Macerayı bulmaya yarar. Kodu bilen herkes yoldaş olarak katılabilir. Hassas bir şey yazmayın.
- **Bildirim gelmiyorsa:**
  - iPhone'da uygulama ana ekrandan açılmış olmalı ve iOS 16.4+ olmalı.
  - Telefon ayarlarında uygulamanın/Chrome'un bildirim izni açık olmalı.
  - Supabase → Edge Functions → `notify-quest` → **Logs** sekmesinde hata var mı bak.
  - `config.js`'teki `VAPID_PUBLIC_KEY` ile Supabase secret'ındaki aynı olmalı.
- Ücretsiz Supabase projesi **1 hafta hiç kullanılmazsa duraklatılır**. Panelden tek tıkla tekrar açılır; veriler silinmez.

## Dosyalar

| Dosya | Ne işe yarar |
|---|---|
| `index.html`, `styles.css`, `app.js` | Uygulamanın kendisi |
| `config.js` | Supabase bağlantı bilgileri (herkese açık değerler) |
| `sw.js` | Bildirimleri alan ve uygulamayı çevrimdışı açan servis çalışanı |
| `manifest.webmanifest`, `icons/` | Telefona kurulum bilgisi ve ikonlar |
| `supabase/schema.sql` | Veritabanı tabloları ve güvenlik kuralları |
| `supabase/functions/notify-quest/index.ts` | Bildirim gönderen sunucu fonksiyonu |
| `araclar/vapid-anahtar-uret.mjs` | Bildirim anahtarı üretici |
| `eski/yks-macera-claude.html` | claude.ai'deki eski sürüm (yedek) |
