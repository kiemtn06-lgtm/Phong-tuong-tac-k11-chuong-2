# Phòng làm bài trực tuyến · Vật lí 11 · Chương II. Sóng

Cùng động cơ và cách dùng với phòng khối 10 Chương II và phòng khối 12 Chương 2 Chất khí: học sinh vào bằng link, nhập họ tên là làm được, không cần tài khoản. Giáo viên vào `/teacher` bằng mật khẩu để mở câu, đóng câu, xem % đúng và danh sách đúng/sai, in phiếu, xuất Word, tải kết quả `.csv`.

**Nội dung**: 90 câu (58 trắc nghiệm, 11 đúng sai, 21 trả lời ngắn), lấy từ tập Bài tập Vật lí 11 học kì I (bản giáo viên) trong Hồ sơ dạy học số. Câu tự luận không đưa vào phòng. Chia **6 nhóm** theo bài:

| Nhóm | Nội dung | Số câu |
|---|---|---|
| 1 | Bài 8. Mô tả sóng | 16 |
| 2 | Bài 9. Sóng ngang. Sóng dọc. Sự truyền năng lượng của sóng cơ | 13 |
| 3 | Bài 11. Sóng điện từ | 15 |
| 4 | Bài 12. Giao thoa sóng | 19 |
| 5 | Bài 13. Sóng dừng | 19 |
| 6 | Bài 15. Thực hành: Đo tốc độ truyền âm | 8 |

Mã câu: `B12-III-05` = Bài 12, Phần III, câu 5 (khớp với số câu trong trang Bài tập theo bài và file Word của từng bài).

**Cần biết về đáp án**
- Đáp án lấy theo bản giáo viên (phương án gạch chân, bảng đáp án). Riêng Bài 11 phần I câu 2, bản Word gạch chân hai phương án, đáp án lấy là B (tần số tăng dần từ sóng vô tuyến đến tia gamma).
- Bản giáo viên không có lời giải nên phòng chỉ hiện đáp án, không có hướng dẫn giải.
- Trả lời ngắn: đáp án lẻ thì nhận sai lệch dưới nửa đơn vị chữ số cuối (ví dụ đáp án 11,3 nhận 11,3 và 11,34). Ô trả lời có nút **±** để thêm/bỏ dấu trừ; máy chấm nhận các kiểu dấu trừ "-", "−", "–" và cả dấu phẩy lẫn dấu chấm.

**Gửi muộn**: câu đã đóng học sinh vẫn gửi được và vẫn biết đúng/sai, nhưng chỉ bài gửi kịp mới tính điểm. Gửi trong vòng 5 giây sau lúc đóng câu vẫn coi là kịp (mạng chậm). Bài muộn hiện ô viền gạch ở bảng kết quả và ghi "(muộn, không tính điểm)" trong file `.csv`.

**Ba kiểu mở câu** (trang giáo viên, dòng "Mở câu theo"):
1. **Nhóm (buổi) · 6 nhóm**: chọn nhóm, "Mở câu" mở câu kế tiếp, "Mở hết bộ này" mở cả nhóm.
2. **Đề ôn trộn ngẫu nhiên · 18 TN – 4 ĐS – 6 TLN**: bốc ngẫu nhiên từ toàn chương các câu chưa mở (đề sau không trùng đề trước). Phải "Đóng tất cả & hiện đáp án" rồi mới soạn đề tiếp. Ngân hàng đủ cho khoảng 2 đề đầy đủ (chỉ có 11 câu đúng sai).
3. **Dạng câu · lộn xộn toàn chương**: 3 tab Trắc nghiệm / Đúng sai / Trả lời ngắn, mở 1 hoặc 5 câu ngẫu nhiên.

**In giấy** và **Xuất Word (.docx)**: ở trang giáo viên, cho câu đang mở, các câu đã mở hoặc cả một nhóm; tick "kèm đáp án" để có bản giáo viên. File Word có công thức là Equation của Word.

## Tạo lại dữ liệu (khi sửa câu hỏi hoặc đáp án)
Sửa nguồn ở kho hồ sơ `D:\Hồ sơ dạy học số\tools\k11_bai_tap\src\B*.txt` (dòng `=> ` là đáp án), rồi:
1. `python -I -X utf8 tools/k11_bai_tap/dung.py` (dựng lại trang hồ sơ, Word)
2. `python -I -X utf8 tools/k11_bai_tap/tao_phong.py D:\phong-tuong-tac-k11-chuong-2` (sinh `data/*.json`, `public/img`, `nguon-goc/*.docx`)
3. Trong kho phòng: `node tools/kiem_tra.js` (đúng định dạng, đáp án gốc được chấm đúng, đủ ảnh).

## Cách 1. Chạy trên laptop của giáo viên (cả lớp cùng Wi-Fi)
1. Cài Node.js (bản LTS) từ nodejs.org, nếu máy chưa có.
2. Bấm đôi `chay-tren-may.bat`, nhập mật khẩu giáo viên (gõ không dấu).
3. Cửa sổ hiện dòng **Cung Wi-Fi: http://192.168.x.x:3000/**. Học sinh mở địa chỉ đó. Giáo viên mở thêm `/teacher`.

## Cách 2. Đưa lên mạng bằng Render (học sinh vào từ bất kì đâu)
1. Kho GitHub của phòng: `kiemtn06-lgtm/Phong-tuong-tac-k11-chuong-2` (mã đã đẩy lên).
2. Trên Render: **Configure account** để cấp quyền cho kho mới, rồi **New, Blueprint**, chọn kho. Render đọc `render.yaml` (dịch vụ `phong-tuong-tac-k11-chuong-2`).
3. Ở ô `TEACHER_PASS`, **tự nhập** mật khẩu giáo viên (không ghi vào kho GitHub). Bấm **Apply**.
4. Địa chỉ: `https://phong-tuong-tac-k11-chuong-2.onrender.com` (nếu Render đổi tên vì trùng thì báo lại để sửa link trong hồ sơ). Học sinh: địa chỉ đó. Giáo viên: thêm `/teacher`. Hồ sơ dạy học số đã gắn sẵn địa chỉ này ở mục Làm bài trực tuyến của khối 11.

### Cần biết khi dùng gói miễn phí của Render
- Máy chủ tự ngủ sau khoảng 15 phút không ai dùng. Mở `/teacher` trước giờ học 5 phút.
- Bài làm mất khi máy chủ ngủ, khởi động lại hoặc cập nhật mã. Cuối buổi bấm **Tải kết quả (.csv)**. Không đẩy bản mới khi học sinh đang làm.
- Tên học sinh được lưu trên máy chủ của Render. Chỉ dùng họ tên và lớp.
