# Web Translate

Web dịch truyện EPUB bằng Gemini API, chạy hoàn toàn trong trình duyệt.

- **Không có server:** file EPUB, bản dịch và API key chỉ lưu trong trình duyệt (IndexedDB). Request chỉ gửi thẳng tới Google.
- **Nhiều API key, tự luân phiên:** gặp lỗi 429 thì key đó nghỉ một lúc, gặp 401/403 thì key bị tắt, hết lượt trong ngày thì chờ sang ngày mới.
- **Giữ nguyên EPUB gốc:** chỉ thay chữ trong từng đoạn, còn CSS, ảnh, mục lục và bố cục giữ nguyên. Có tuỳ chọn dịch mục lục và xuất bản song ngữ.
- **Chạy nền và chạy tiếp được:** việc dịch chạy trong Web Worker và lưu kết quả sau mỗi cụm. Đóng tab thì lần sau mở lại bấm “Dịch tiếp”.
- **Sửa tay:** xem bản gốc và bản dịch cạnh nhau, sửa từng đoạn. Bản sửa tay không bị ghi đè khi dịch lại.
- Giao diện song ngữ Việt / Anh, có chế độ sáng / tối.

## Chạy trên máy

Cần Node.js 20 trở lên.

```bash
npm install
npm run dev        # mở http://localhost:5173
npm run build      # build ra thư mục dist/
npm run preview    # xem thử bản build
```

## Cấu trúc code

```
src/
  lib/
    types.ts     Kiểu dữ liệu dùng chung
    db.ts        IndexedDB (truyện, file gốc, cụm dịch, key, cài đặt, nhật ký)
    epub.ts      Đọc EPUB, tách đoạn, ghép bản dịch và đóng lại EPUB
    gemini.ts    Gọi Gemini API (generateContent, liệt kê model) và phân loại lỗi
    prompt.ts    Mẫu prompt, ghép biến, đọc JSON trả về
    keypool.ts   Luân phiên key: giới hạn theo phút / ngày, thời gian nghỉ
    worker.ts    Web Worker chạy hàng đợi dịch
    runner.ts    Cầu nối giữa giao diện và worker, giữ màn hình sáng khi đang dịch
    actions.ts   Thao tác cấp cao: tạo truyện, chuẩn bị cụm, tải EPUB, dịch thử…
  screens/       Các màn hình: Thư viện, Wizard 5 bước, API key, Tiến độ
  ui/            Header, stepper, icon, các thành phần dùng chung
  i18n.tsx       Chuỗi giao diện tiếng Việt / tiếng Anh
```

## Cách dịch hoạt động

1. Mỗi chương được tách thành các “khối lá” có chữ (`p`, `h1`–`h6`, `li`, `td`…), theo đúng thứ tự trong file.
2. Các khối được gom thành cụm khoảng 2.500 ký tự (chỉnh được ở *Prompt → Nâng cao*). Mỗi cụm được gửi kèm vài đoạn phía trước làm ngữ cảnh.
3. Web gửi cho Gemini một object JSON dạng `{"p1": "...", "p2": "..."}` và yêu cầu trả về đúng các khoá đó. Nếu thiếu đoạn thì gửi lại.
4. Khi đóng gói, bản dịch được đặt vào nút chữ dài nhất của mỗi khối. Các thẻ bọc ngoài (`span`, `style`…) và thụt đầu dòng được giữ nguyên.
5. Bảng thuật ngữ chỉ đưa vào prompt những từ thực sự có trong cụm đang dịch, để tiết kiệm token.
