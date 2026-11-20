# Web Translate

Web dịch truyện EPUB bằng Gemini API, chạy hoàn toàn trong trình duyệt. Dịch được giữa hầu hết các ngôn ngữ (Trung, Nhật, Hàn, Anh… sang Việt hoặc ngôn ngữ khác).

- **Khám phá:** xem bảng xếp hạng truyện từ Khởi Điểm (Qidian), Tấn Giang (JJWXC), Fanqie (qua [DaoSearch](https://daosearch.io/)) và Open Library, cập nhật mỗi ngày. Trang chỉ hiện tên, tác giả và tóm tắt ngắn kèm link, không lấy nội dung truyện.
- **Không có server:** file EPUB, bản dịch và API key chỉ lưu trong trình duyệt (IndexedDB). Request chỉ gửi thẳng tới Google.
- **Nhiều API key, tự luân phiên:** gặp lỗi 429 thì key đó nghỉ một lúc, gặp 401/403 thì key bị tắt, hết lượt trong ngày thì chờ sang ngày mới.
- **Giữ nguyên EPUB gốc:** chỉ thay chữ trong từng đoạn, còn CSS, ảnh, mục lục và bố cục giữ nguyên. Có tuỳ chọn dịch mục lục và xuất bản song ngữ.
- **Chạy nền và chạy tiếp được:** việc dịch chạy trong Web Worker và lưu kết quả sau mỗi cụm.
- **Sửa tay:** xem bản gốc và bản dịch cạnh nhau, sửa từng đoạn.
- Giao diện song ngữ Việt / Anh, có chế độ sáng / tối.

## Hướng dẫn sử dụng

1. Mở **https://nguyentramy-dasick.github.io/web-translate/**
2. Lấy API key Gemini miễn phí tại [Google AI Studio](https://aistudio.google.com/apikey), rồi dán vào mục **API key**. Có thể thêm nhiều key, nên dùng key của nhiều project khác nhau.
3. Vào **Dịch truyện mới**, tải file `.epub` lên, chọn ngôn ngữ và chương cần dịch, chỉnh prompt rồi bấm **Bắt đầu dịch**.
4. Dịch xong (hoặc giữa chừng) bấm **Tải EPUB** để lấy file.

Lưu ý:
- Dữ liệu chỉ nằm trong trình duyệt bạn đang dùng. Đổi trình duyệt, đổi máy hoặc xoá dữ liệu duyệt web thì thư viện và key sẽ mất.
- Nên để tab mở khi dịch truyện dài. Nếu lỡ đóng tab, mở lại web và bấm **Dịch tiếp**.

## Nguồn dữ liệu

- Bảng xếp hạng truyện Trung Quốc ở trang Khám phá (Khởi Điểm, Tấn Giang, Fanqie) lấy từ [DaoSearch](https://daosearch.io/). Tên, tóm tắt và ảnh bìa thuộc về tác giả và các trang gốc.
- Bảng xếp hạng sách quốc tế lấy từ [Open Library](https://openlibrary.org/).
- Bản dịch do [Gemini API](https://ai.google.dev/) tạo, bằng API key của chính người dùng.
