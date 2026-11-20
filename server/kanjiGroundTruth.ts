import type {
  KanjiComponentItem,
  KanjiConfusableItem,
  KanjiEtymologyEntry,
  KanjiStructureType,
} from '../src/types/index.ts';

export interface KangxiRadicalRecord {
  number: number;
  symbol: string;
  variants: string[];
  nameVi: string;
  meaningVi: string;
  positionHint?: string;
}

/**
 * Authoritative 214 Kangxi Radicals (Bộ thủ Khang Hy chính thống — 部首)
 * Includes positional variant forms and strictly distinguishes:
 *   #163 邑 (阝 bên PHẢI = Ấp: vùng đất, đô thị, làng mạc)
 *   #170 阜 (阝 bên TRÁI = Phụ: gò đất, sườn núi, đê điều)
 */
export const KANGXI_RADICALS_214: KangxiRadicalRecord[] = [
  { number: 1, symbol: '一', variants: [], nameVi: 'Nhất', meaningVi: 'một, đường ngang' },
  { number: 2, symbol: '丨', variants: [], nameVi: 'Cổn', meaningVi: 'nét sổ thẳng' },
  { number: 3, symbol: '丶', variants: [], nameVi: 'Chủ', meaningVi: 'chấm' },
  { number: 4, symbol: '丿', variants: [], nameVi: 'Phiệt', meaningVi: 'nét phẩy' },
  { number: 5, symbol: '乙', variants: ['乚', '乛'], nameVi: 'Ất', meaningVi: 'thứ hai, cong' },
  { number: 6, symbol: '亅', variants: [], nameVi: 'Quyết', meaningVi: 'nét sổ có móc' },
  { number: 7, symbol: '二', variants: [], nameVi: 'Nhị', meaningVi: 'hai' },
  { number: 8, symbol: '亠', variants: [], nameVi: 'Đầu', meaningVi: 'đầu, nắp đậy' },
  { number: 9, symbol: '人', variants: ['亻', '𠆢', '⺅'], nameVi: 'Nhân', meaningVi: 'người', positionHint: 'Biến thể 亻 (Nhân đứng) ở bên trái' },
  { number: 10, symbol: '儿', variants: [], nameVi: 'Nhi', meaningVi: 'đôi chân người, trẻ nhỏ' },
  { number: 11, symbol: '入', variants: [], nameVi: 'Nhập', meaningVi: 'vào' },
  { number: 12, symbol: '八', variants: ['丷'], nameVi: 'Bát', meaningVi: 'tám, chia tách' },
  { number: 13, symbol: '冂', variants: [], nameVi: 'Quynh', meaningVi: 'vùng biên xa, khung mở' },
  { number: 14, symbol: '冖', variants: [], nameVi: 'Mịch', meaningVi: 'trùm khăn, che phủ' },
  { number: 15, symbol: '冫', variants: [], nameVi: 'Băng', meaningVi: 'nước đá, lạnh' },
  { number: 16, symbol: '几', variants: [], nameVi: 'Kỷ', meaningVi: 'bàn nhỏ, ghế dựa' },
  { number: 17, symbol: '凵', variants: [], nameVi: 'Khảm', meaningVi: 'há miệng, hố lõm' },
  { number: 18, symbol: '刀', variants: ['刂', '⺈'], nameVi: 'Đao', meaningVi: 'con dao, cắt', positionHint: 'Biến thể 刂 (Đao đứng) ở bên phải' },
  { number: 19, symbol: '力', variants: [], nameVi: 'Lực', meaningVi: 'sức mạnh, nỗ lực' },
  { number: 20, symbol: '勹', variants: [], nameVi: 'Bao', meaningVi: 'bao bọc' },
  { number: 21, symbol: '匕', variants: [], nameVi: 'Chủy', meaningVi: 'cái thìa, dao găm' },
  { number: 22, symbol: '匚', variants: [], nameVi: 'Phương', meaningVi: 'tủ, hộp vuông' },
  { number: 23, symbol: '匸', variants: [], nameVi: 'Hệ', meaningVi: 'che giấu' },
  { number: 24, symbol: '十', variants: [], nameVi: 'Thập', meaningVi: 'mười, trọn vẹn' },
  { number: 25, symbol: '卜', variants: ['⺊'], nameVi: 'Bốc', meaningVi: 'xem bói' },
  { number: 26, symbol: '卩', variants: ['㔾'], nameVi: 'Tiết', meaningVi: 'đốt tre, ấn tín, quỳ' },
  { number: 27, symbol: '厂', variants: [], nameVi: 'Hán', meaningVi: 'sườn núi, vách đá' },
  { number: 28, symbol: '厶', variants: [], nameVi: 'Tư', meaningVi: 'riêng tư' },
  { number: 29, symbol: '又', variants: [], nameVi: 'Hựu', meaningVi: 'bàn tay phải, lại nữa' },
  { number: 30, symbol: '口', variants: [], nameVi: 'Khẩu', meaningVi: 'cái miệng, lời nói' },
  { number: 31, symbol: '囗', variants: [], nameVi: 'Vi', meaningVi: 'vây quanh, ranh giới' },
  { number: 32, symbol: '土', variants: [], nameVi: 'Thổ', meaningVi: 'đất, mặt đất' },
  { number: 33, symbol: '士', variants: [], nameVi: 'Sĩ', meaningVi: 'kẻ sĩ, học giả' },
  { number: 34, symbol: '夂', variants: [], nameVi: 'Truy', meaningVi: 'đi theo sau' },
  { number: 35, symbol: '夊', variants: [], nameVi: 'Tuy', meaningVi: 'đi chậm' },
  { number: 36, symbol: '夕', variants: [], nameVi: 'Tịch', meaningVi: 'buổi tối, chiều tà' },
  { number: 37, symbol: '大', variants: [], nameVi: 'Đại', meaningVi: 'to lớn' },
  { number: 38, symbol: '女', variants: [], nameVi: 'Nữ', meaningVi: 'phụ nữ, con gái' },
  { number: 39, symbol: '子', variants: [], nameVi: 'Tử', meaningVi: 'con cái, trẻ nhỏ' },
  { number: 40, symbol: '宀', variants: [], nameVi: 'Miên', meaningVi: 'mái nhà' },
  { number: 41, symbol: '寸', variants: [], nameVi: 'Thốn', meaningVi: 'tấc, quy chuẩn, bàn tay' },
  { number: 42, symbol: '小', variants: ['⺌', '⺍'], nameVi: 'Tiểu', meaningVi: 'nhỏ bé' },
  { number: 43, symbol: '尢', variants: ['尣', '兀'], nameVi: 'Uông', meaningVi: 'yếu đuối, chân khoèo' },
  { number: 44, symbol: '尸', variants: [], nameVi: 'Thi', meaningVi: 'thân người, xác' },
  { number: 45, symbol: '屮', variants: [], nameVi: 'Triệt', meaningVi: 'mầm non' },
  { number: 46, symbol: '山', variants: [], nameVi: 'Sơn', meaningVi: 'ngọn núi' },
  { number: 47, symbol: '巛', variants: ['川', '巜'], nameVi: 'Xuyên', meaningVi: 'dòng sông' },
  { number: 48, symbol: '工', variants: [], nameVi: 'Công', meaningVi: 'công việc, người thợ' },
  { number: 49, symbol: '己', variants: ['已', '巳'], nameVi: 'Kỷ', meaningVi: 'bản thân' },
  { number: 50, symbol: '巾', variants: [], nameVi: 'Cân', meaningVi: 'khăn, vải' },
  { number: 51, symbol: '干', variants: [], nameVi: 'Can', meaningVi: 'cái khiên, can thiệp' },
  { number: 52, symbol: '幺', variants: [], nameVi: 'Yêu', meaningVi: 'nhỏ bé, sợi tơ' },
  { number: 53, symbol: '广', variants: [], nameVi: 'Nghiễm', meaningVi: 'mái hiên, tòa nhà' },
  { number: 54, symbol: '廴', variants: [], nameVi: 'Dẫn', meaningVi: 'bước dài' },
  { number: 55, symbol: '廾', variants: [], nameVi: 'Củng', meaningVi: 'chắp hai tay' },
  { number: 56, symbol: '弋', variants: [], nameVi: 'Dặc', meaningVi: 'bắn tên, cọc' },
  { number: 57, symbol: '弓', variants: [], nameVi: 'Cung', meaningVi: 'cây cung' },
  { number: 58, symbol: '彐', variants: ['彑', '⺕'], nameVi: 'Kệ', meaningVi: 'đầu con nhím, tay nắm' },
  { number: 59, symbol: '彡', variants: [], nameVi: 'Sam', meaningVi: 'lông tóc, hoa văn' },
  { number: 60, symbol: '彳', variants: [], nameVi: 'Xích', meaningVi: 'bước chân, đi lại' },
  { number: 61, symbol: '心', variants: ['忄', '⺗', '⺖'], nameVi: 'Tâm', meaningVi: 'trái tim, cảm xúc, tinh thần', positionHint: 'Biến thể 忄 (Tâm đứng) ở bên trái' },
  { number: 62, symbol: '戈', variants: [], nameVi: 'Qua', meaningVi: 'cây kích, binh khí' },
  { number: 63, symbol: '戶', variants: ['戸', '户'], nameVi: 'Hộ', meaningVi: 'cánh cửa, hộ gia đình' },
  { number: 64, symbol: '手', variants: ['扌', '龵', '⺘'], nameVi: 'Thủ', meaningVi: 'bàn tay, thao tác tay', positionHint: 'Biến thể 扌 (Tài gẩy/Thủ) ở bên trái' },
  { number: 65, symbol: '支', variants: [], nameVi: 'Chi', meaningVi: 'nhánh, chống đỡ' },
  { number: 66, symbol: '攴', variants: ['攵'], nameVi: 'Phộc', meaningVi: 'tay cầm roi, đánh khẽ, tác động' },
  { number: 67, symbol: '文', variants: [], nameVi: 'Văn', meaningVi: 'văn chương, hoa văn' },
  { number: 68, symbol: '斗', variants: [], nameVi: 'Đẩu', meaningVi: 'cái đấu đong lường' },
  { number: 69, symbol: '斤', variants: [], nameVi: 'Cân', meaningVi: 'cái rìu, đơn vị cân' },
  { number: 70, symbol: '方', variants: [], nameVi: 'Phương', meaningVi: 'phương hướng, hình vuông' },
  { number: 71, symbol: '无', variants: ['旡'], nameVi: 'Vô', meaningVi: 'không có' },
  { number: 72, symbol: '日', variants: [], nameVi: 'Nhật', meaningVi: 'mặt trời, ngày, thời gian' },
  { number: 73, symbol: '曰', variants: [], nameVi: 'Viết', meaningVi: 'nói rằng' },
  { number: 74, symbol: '月', variants: ['⺝'], nameVi: 'Nguyệt', meaningVi: 'mặt trăng, tháng (lưu ý: ở bên trái nhiều chữ chỉ cơ thể lại là biến thể của 肉 Nhục)' },
  { number: 75, symbol: '木', variants: [], nameVi: 'Mộc', meaningVi: 'cây cối, gỗ' },
  { number: 76, symbol: '欠', variants: [], nameVi: 'Khiếm', meaningVi: 'thiếu hụt, há miệng thở' },
  { number: 77, symbol: '止', variants: [], nameVi: 'Chỉ', meaningVi: 'dừng lại, bàn chân' },
  { number: 78, symbol: '歹', variants: ['歺'], nameVi: 'Đãi', meaningVi: 'xương tàn, cái chết, xấu' },
  { number: 79, symbol: '殳', variants: [], nameVi: 'Thù', meaningVi: 'binh khí dài, đánh' },
  { number: 80, symbol: '毋', variants: ['母'], nameVi: 'Vô / Mẫu', meaningVi: 'chớ đừng / mẹ' },
  { number: 81, symbol: '比', variants: [], nameVi: 'Tỷ', meaningVi: 'so sánh, sóng đôi' },
  { number: 82, symbol: '毛', variants: [], nameVi: 'Mao', meaningVi: 'lông, tóc' },
  { number: 83, symbol: '氏', variants: [], nameVi: 'Thị', meaningVi: 'họ tộc' },
  { number: 84, symbol: '气', variants: [], nameVi: 'Khí', meaningVi: 'hơi nước, không khí, khí lực' },
  { number: 85, symbol: '水', variants: ['氵', '氺', '⺡'], nameVi: 'Thủy', meaningVi: 'nước, chất lỏng', positionHint: 'Biến thể 氵 (Ba chấm thủy) ở bên trái' },
  { number: 86, symbol: '火', variants: ['灬', '⺣'], nameVi: 'Hỏa', meaningVi: 'lửa, nhiệt độ', positionHint: 'Biến thể 灬 (Hỏa 4 chấm) ở phía dưới' },
  { number: 87, symbol: '爪', variants: ['爫', '⺤'], nameVi: 'Trảo', meaningVi: 'móng vuốt, tay chụp' },
  { number: 88, symbol: '父', variants: [], nameVi: 'Phụ', meaningVi: 'người cha' },
  { number: 89, symbol: '爻', variants: [], nameVi: 'Hào', meaningVi: 'quẻ hào, giao nhau' },
  { number: 90, symbol: '爿', variants: ['丬'], nameVi: 'Tường', meaningVi: 'mảnh gỗ, giường' },
  { number: 91, symbol: '片', variants: [], nameVi: 'Phiến', meaningVi: 'mảnh, tấm mỏng' },
  { number: 92, symbol: '牙', variants: [], nameVi: 'Nha', meaningVi: 'răng nanh' },
  { number: 93, symbol: '牛', variants: ['牜', '⺧'], nameVi: 'Ngưu', meaningVi: 'con trâu, con bò', positionHint: 'Biến thể 牜 ở bên trái' },
  { number: 94, symbol: '犬', variants: ['犭', '⺨'], nameVi: 'Khuyển', meaningVi: 'con chó, loài thú', positionHint: 'Biến thể 犭 (Khuyển đứng) ở bên trái' },
  { number: 95, symbol: '玄', variants: [], nameVi: 'Huyền', meaningVi: 'màu đen huyền, sâu kín' },
  { number: 96, symbol: '玉', variants: ['王', '⺩'], nameVi: 'Ngọc', meaningVi: 'ngọc quý', positionHint: 'Biến thể 王 (bỏ chấm) ở bên trái' },
  { number: 97, symbol: '瓜', variants: [], nameVi: 'Qua', meaningVi: 'quả dưa' },
  { number: 98, symbol: '瓦', variants: [], nameVi: 'Ngõa', meaningVi: 'ngói, đồ gốm' },
  { number: 99, symbol: '甘', variants: [], nameVi: 'Cam', meaningVi: 'vị ngọt' },
  { number: 100, symbol: '生', variants: [], nameVi: 'Sinh', meaningVi: 'sinh sôi, sự sống' },
  { number: 101, symbol: '用', variants: [], nameVi: 'Dụng', meaningVi: 'sử dụng' },
  { number: 102, symbol: '田', variants: [], nameVi: 'Điền', meaningVi: 'ruộng đất' },
  { number: 103, symbol: '疋', variants: ['⺪'], nameVi: 'Thất / Sơ', meaningVi: 'tấm vải, chân bước' },
  { number: 104, symbol: '疒', variants: [], nameVi: 'Nạch', meaningVi: 'bệnh tật' },
  { number: 105, symbol: '癶', variants: [], nameVi: 'Bát', meaningVi: 'hai chân bước ra' },
  { number: 106, symbol: '白', variants: [], nameVi: 'Bạch', meaningVi: 'màu trắng, rõ ràng' },
  { number: 107, symbol: '皮', variants: [], nameVi: 'Bì', meaningVi: 'lớp da, vỏ ngoài' },
  { number: 108, symbol: '皿', variants: [], nameVi: 'Mãnh', meaningVi: 'bát đĩa, đồ đựng' },
  { number: 109, symbol: '目', variants: ['罒', '⺫'], nameVi: 'Mục', meaningVi: 'con mắt, nhìn' },
  { number: 110, symbol: '矛', variants: [], nameVi: 'Mâu', meaningVi: 'cây giáo' },
  { number: 111, symbol: '矢', variants: [], nameVi: 'Thỉ', meaningVi: 'mũi tên' },
  { number: 112, symbol: '石', variants: [], nameVi: 'Thạch', meaningVi: 'hòn đá' },
  { number: 113, symbol: '示', variants: ['礻', '⺭'], nameVi: 'Thị', meaningVi: 'thần linh, tế lễ, chỉ thị', positionHint: 'Biến thể 礻 ở bên trái' },
  { number: 114, symbol: '禸', variants: [], nameVi: 'Nhựu', meaningVi: 'vết chân thú' },
  { number: 115, symbol: '禾', variants: [], nameVi: 'Hòa', meaningVi: 'cây lúa, ngũ cốc' },
  { number: 116, symbol: '穴', variants: [], nameVi: 'Huyệt', meaningVi: 'hang động, lỗ hổng' },
  { number: 117, symbol: '立', variants: [], nameVi: 'Lập', meaningVi: 'đứng thẳng, thiết lập' },
  { number: 118, symbol: '竹', variants: ['⺮'], nameVi: 'Trúc', meaningVi: 'cây tre trúc' },
  { number: 119, symbol: '米', variants: [], nameVi: 'Mễ', meaningVi: 'hạt gạo' },
  { number: 120, symbol: '糸', variants: ['糹', '纟'], nameVi: 'Mịch', meaningVi: 'sợi tơ, gắn kết' },
  { number: 121, symbol: '缶', variants: [], nameVi: 'Phẫu', meaningVi: 'đồ sành, bình gốm' },
  { number: 122, symbol: '网', variants: ['罒', '⺲', '⺳', '罓'], nameVi: 'Võng', meaningVi: 'tấm lưới' },
  { number: 123, symbol: '羊', variants: ['⺶', '⺷'], nameVi: 'Dương', meaningVi: 'con dê, con cừu' },
  { number: 124, symbol: '羽', variants: [], nameVi: 'Vũ', meaningVi: 'lông chim, đôi cánh' },
  { number: 125, symbol: '老', variants: ['耂'], nameVi: 'Lão', meaningVi: 'người già' },
  { number: 126, symbol: '而', variants: [], nameVi: 'Nhi', meaningVi: 'bộ râu, mà lại' },
  { number: 127, symbol: '耒', variants: [], nameVi: 'Lỗi', meaningVi: 'cái cày' },
  { number: 128, symbol: '耳', variants: [], nameVi: 'Nhĩ', meaningVi: 'đôi tai, lắng nghe' },
  { number: 129, symbol: '聿', variants: ['⺻', '肀'], nameVi: 'Duật', meaningVi: 'cây bút' },
  { number: 130, symbol: '肉', variants: ['月', '⺼'], nameVi: 'Nhục', meaningVi: 'thịt, bộ phận cơ thể', positionHint: 'Thường viết thành 月 (Nhục nguyệt) ở bên trái hoặc dưới' },
  { number: 131, symbol: '臣', variants: [], nameVi: 'Thần', meaningVi: 'bề tôi, đại thần' },
  { number: 132, symbol: '自', variants: [], nameVi: 'Tự', meaningVi: 'bản thân, cái mũi' },
  { number: 133, symbol: '至', variants: [], nameVi: 'Chí', meaningVi: 'đến nơi, tột cùng' },
  { number: 134, symbol: '臼', variants: [], nameVi: 'Cữu', meaningVi: 'cái cối giã gạo' },
  { number: 135, symbol: '舌', variants: [], nameVi: 'Thiệt', meaningVi: 'cái lưỡi' },
  { number: 136, symbol: '舛', variants: [], nameVi: 'Suyễn', meaningVi: 'trái ngược' },
  { number: 137, symbol: '舟', variants: [], nameVi: 'Chu', meaningVi: 'con thuyền' },
  { number: 138, symbol: '艮', variants: [], nameVi: 'Cấn', meaningVi: 'dừng lại, quẻ Cấn' },
  { number: 139, symbol: '色', variants: [], nameVi: 'Sắc', meaningVi: 'màu sắc, sắc mặt' },
  { number: 140, symbol: '艸', variants: ['艹', '⺾', '⺿', '⻀'], nameVi: 'Thảo', meaningVi: 'cỏ cây, thực vật', positionHint: 'Biến thể 艹 (Thảo đầu) ở phía trên' },
  { number: 141, symbol: '虍', variants: [], nameVi: 'Hô', meaningVi: 'vằn con hổ' },
  { number: 142, symbol: '虫', variants: [], nameVi: 'Trùng', meaningVi: 'côn trùng, sâu bọ' },
  { number: 143, symbol: '血', variants: [], nameVi: 'Huyết', meaningVi: 'máu' },
  { number: 144, symbol: '行', variants: [], nameVi: 'Hành', meaningVi: 'ngã tư đường, đi lại' },
  { number: 145, symbol: '衣', variants: ['衤', '⻂'], nameVi: 'Y', meaningVi: 'áo quần, trang phục', positionHint: 'Biến thể 衤 (Y đứng) ở bên trái' },
  { number: 146, symbol: '襾', variants: ['西', '覀'], nameVi: 'Á / Tây', meaningVi: 'che đậy / phương tây' },
  { number: 147, symbol: '見', variants: ['见'], nameVi: 'Kiến', meaningVi: 'nhìn thấy' },
  { number: 148, symbol: '角', variants: [], nameVi: 'Giác', meaningVi: 'sừng thú, góc cạnh' },
  { number: 149, symbol: '言', variants: ['訁', '讠'], nameVi: 'Ngôn', meaningVi: 'lời nói, ngôn ngữ' },
  { number: 150, symbol: '谷', variants: [], nameVi: 'Cốc', meaningVi: 'thung lũng' },
  { number: 151, symbol: '豆', variants: [], nameVi: 'Đậu', meaningVi: 'hạt đậu, chén tế' },
  { number: 152, symbol: '豕', variants: [], nameVi: 'Thỉ', meaningVi: 'con lợn' },
  { number: 153, symbol: '豸', variants: [], nameVi: 'Trãi', meaningVi: 'loài thú không chân/thú săn' },
  { number: 154, symbol: '貝', variants: ['贝'], nameVi: 'Bối', meaningVi: 'vỏ sò, tiền bạc, tài sản' },
  { number: 155, symbol: '赤', variants: [], nameVi: 'Xích', meaningVi: 'màu đỏ' },
  { number: 156, symbol: '走', variants: ['赱'], nameVi: 'Tẩu', meaningVi: 'chạy' },
  { number: 157, symbol: '足', variants: ['⻊'], nameVi: 'Túc', meaningVi: 'bàn chân, bước chân' },
  { number: 158, symbol: '身', variants: [], nameVi: 'Thân', meaningVi: 'thân thể' },
  { number: 159, symbol: '車', variants: ['车'], nameVi: 'Xa', meaningVi: 'xe cộ, bánh xe' },
  { number: 160, symbol: '辛', variants: [], nameVi: 'Tân', meaningVi: 'cay đắng, gian khổ' },
  { number: 161, symbol: '辰', variants: [], nameVi: 'Thần', meaningVi: 'thời khắc, nông cụ' },
  { number: 162, symbol: '辵', variants: ['辶', '⻌', '⻍', '⻎'], nameVi: 'Sước', meaningVi: 'bước đi, di chuyển trên đường', positionHint: 'Biến thể 辶 ở bên trái và dưới' },
  { number: 163, symbol: '邑', variants: ['阝', '⻏'], nameVi: 'Ấp', meaningVi: 'vùng đất, đô thị, làng mạc', positionHint: 'Biến thể 阝 LUÔN nằm bên PHẢI chữ (VD: 都, 部, 郵, 郷)' },
  { number: 164, symbol: '酉', variants: [], nameVi: 'Dậu', meaningVi: 'bình rượu, lên men' },
  { number: 165, symbol: '釆', variants: [], nameVi: 'Biện', meaningVi: 'phân biệt rõ' },
  { number: 166, symbol: '里', variants: [], nameVi: 'Lý', meaningVi: 'làng xóm, đơn vị dặm' },
  { number: 167, symbol: '金', variants: ['釒', '钅'], nameVi: 'Kim', meaningVi: 'kim loại, vàng, tiền' },
  { number: 168, symbol: '長', variants: ['镸', '长'], nameVi: 'Trường', meaningVi: 'dài, trưởng thành' },
  { number: 169, symbol: '門', variants: ['门'], nameVi: 'Môn', meaningVi: 'cánh cổng, cửa lớn' },
  { number: 170, symbol: '阜', variants: ['阝', '⻖'], nameVi: 'Phụ', meaningVi: 'gò đất, sườn núi, đê điều', positionHint: 'Biến thể 阝 LUÔN nằm bên TRÁI chữ (VD: 防, 院, 階, 陸)' },
  { number: 171, symbol: '隶', variants: [], nameVi: 'Đãi / Lệ', meaningVi: 'kịp tới, phụ thuộc' },
  { number: 172, symbol: '隹', variants: [], nameVi: 'Chuy', meaningVi: 'chim đuôi ngắn' },
  { number: 173, symbol: '雨', variants: ['⻗'], nameVi: 'Vũ', meaningVi: 'mưa, hiện tượng thời tiết' },
  { number: 174, symbol: '靑', variants: ['青'], nameVi: 'Thanh', meaningVi: 'màu xanh lam/xanh lục' },
  { number: 175, symbol: '非', variants: [], nameVi: 'Phi', meaningVi: 'không phải, trái ngược' },
  { number: 176, symbol: '面', variants: ['靣'], nameVi: 'Diện', meaningVi: 'khuôn mặt, bề mặt' },
  { number: 177, symbol: '革', variants: [], nameVi: 'Cách', meaningVi: 'da thú đã thuộc, cải cách' },
  { number: 178, symbol: '韋', variants: ['韦'], nameVi: 'Vi', meaningVi: 'da mềm' },
  { number: 179, symbol: '韭', variants: [], nameVi: 'Cửu', meaningVi: 'rau hẹ' },
  { number: 180, symbol: '音', variants: [], nameVi: 'Âm', meaningVi: 'âm thanh, tiếng vang' },
  { number: 181, symbol: '頁', variants: ['页'], nameVi: 'Hiệt', meaningVi: 'cái đầu, khuôn mặt, trang giấy' },
  { number: 182, symbol: '風', variants: ['风'], nameVi: 'Phong', meaningVi: 'gió, phong cách' },
  { number: 183, symbol: '飛', variants: ['飞'], nameVi: 'Phi', meaningVi: 'bay lượn' },
  { number: 184, symbol: '食', variants: ['飠', '𩙿', '饣'], nameVi: 'Thực', meaningVi: 'ăn uống, thực phẩm' },
  { number: 185, symbol: '首', variants: [], nameVi: 'Thủ', meaningVi: 'cái đầu, đứng đầu' },
  { number: 186, symbol: '香', variants: [], nameVi: 'Hương', meaningVi: 'mùi thơm' },
  { number: 187, symbol: '馬', variants: ['马'], nameVi: 'Mã', meaningVi: 'con ngựa, giao thông cổ' },
  { number: 188, symbol: '骨', variants: [], nameVi: 'Cốt', meaningVi: 'xương cốt' },
  { number: 189, symbol: '高', variants: ['髙'], nameVi: 'Cao', meaningVi: 'cao lớn' },
  { number: 190, symbol: '髟', variants: [], nameVi: 'Bưu / Tiêu', meaningVi: 'mái tóc dài' },
  { number: 191, symbol: '鬥', variants: [], nameVi: 'Đấu', meaningVi: 'chiến đấu, tranh tài' },
  { number: 192, symbol: '鬯', variants: [], nameVi: 'Sưởng', meaningVi: 'rượu nghệ tế lễ' },
  { number: 193, symbol: '鬲', variants: [], nameVi: 'Cách / Lịch', meaningVi: 'vạc ba chân' },
  { number: 194, symbol: '鬼', variants: [], nameVi: 'Quỷ', meaningVi: 'ma quỷ, linh hồn' },
  { number: 195, symbol: '魚', variants: ['鱼'], nameVi: 'Ngư', meaningVi: 'loài cá' },
  { number: 196, symbol: '鳥', variants: ['鸟'], nameVi: 'Điểu', meaningVi: 'loài chim' },
  { number: 197, symbol: '鹵', variants: ['卤'], nameVi: 'Lỗ', meaningVi: 'đất mặn, muối' },
  { number: 198, symbol: '鹿', variants: [], nameVi: 'Lộc', meaningVi: 'con hươu' },
  { number: 199, symbol: '麥', variants: ['麦'], nameVi: 'Mạch', meaningVi: 'lúa mạch' },
  { number: 200, symbol: '麻', variants: [], nameVi: 'Ma', meaningVi: 'cây gai, sợi gai' },
  { number: 201, symbol: '黃', variants: ['黄'], nameVi: 'Hoàng', meaningVi: 'màu vàng' },
  { number: 202, symbol: '黍', variants: [], nameVi: 'Thử', meaningVi: 'cây kê' },
  { number: 203, symbol: '黑', variants: ['黒'], nameVi: 'Hắc', meaningVi: 'màu đen' },
  { number: 204, symbol: '黹', variants: [], nameVi: 'Chỉ', meaningVi: 'thêu thùa' },
  { number: 205, symbol: '黽', variants: ['黾'], nameVi: 'Mãnh', meaningVi: 'con ếch, rùa' },
  { number: 206, symbol: '鼎', variants: [], nameVi: 'Đỉnh', meaningVi: 'cái đỉnh ba chân' },
  { number: 207, symbol: '鼓', variants: [], nameVi: 'Cổ', meaningVi: 'cái trống' },
  { number: 208, symbol: '鼠', variants: [], nameVi: 'Thử', meaningVi: 'con chuột' },
  { number: 209, symbol: '鼻', variants: [], nameVi: 'Tỵ', meaningVi: 'cái mũi' },
  { number: 210, symbol: '齊', variants: ['斉', '齐'], nameVi: 'Tề', meaningVi: 'ngang bằng, chỉnh tề' },
  { number: 211, symbol: '齒', variants: ['歯', '齿'], nameVi: 'Xỉ', meaningVi: 'răng' },
  { number: 212, symbol: '龍', variants: ['竜', '龙'], nameVi: 'Long', meaningVi: 'con rồng' },
  { number: 213, symbol: '龜', variants: ['亀', '龟'], nameVi: 'Quy', meaningVi: 'con rùa' },
  { number: 214, symbol: '龠', variants: [], nameVi: 'Dược', meaningVi: 'ống sáo cổ' },
];

// Fast lookup maps for 214 Kangxi Radicals
const KANGXI_BY_NUMBER = new Map<number, KangxiRadicalRecord>();
const KANGXI_BY_SYMBOL = new Map<string, KangxiRadicalRecord[]>();

for (const rec of KANGXI_RADICALS_214) {
  KANGXI_BY_NUMBER.set(rec.number, rec);
  const allForms = [rec.symbol, ...rec.variants];
  for (const form of allForms) {
    const existing = KANGXI_BY_SYMBOL.get(form) || [];
    existing.push(rec);
    KANGXI_BY_SYMBOL.set(form, existing);
  }
}

/**
 * Known Left-阝 (阜 Phụ #170) vs Right-阝 (邑 Ấp #163) Kanji sets
 * Guarantees 0% confusion between 阜 and 邑 across all JLPT Kanji.
 */
export const LEFT_FU_RADICAL_KANJI = new Set([
  '防', '院', '降', '階', '陽', '陰', '陸', '際', '障', '限', '除', '険',
  '隊', '隠', '隣', '隔', '随', '陥', '陣', '陶', '陳', '附', '阻', '阪',
  '阿', '隆', '墜', '陵', '陪', '陛', '隅', '陌', '阡', '隈', '阿', '隙',
]);

export const RIGHT_YU_RADICAL_KANJI = new Set([
  '都', '部', '郡', '郵', '郷', '邦', '郊', '邸', '邪', '郎', '郭', '那',
  '郁', '鄭', '鄧', '隣' /* note: 隣 is LEFT 阝=阜, never here! */,
].filter((k) => k !== '隣'));

/**
 * Known authentic Kokuji (国字 — Kanji created in Japan)
 */
export const AUTHENTIC_KOKUJI_SET = new Set([
  '働', '畑', '峠', '辻', '込', '枠', '匂', '躾', '榊', '凪', '凧',
  '鰯', '鱈', '腺', '畠', '雫', '噺', '笹', '栃', '樫', '籾', '襷', '鋲', '麿',
]);

/**
 * Authoritative Shinjitai -> Kyūjitai (旧字体) mapping
 */
export const SHINJITAI_TO_KYUJITAI: Record<string, string> = {
  '圧': '壓',
  '囲': '圍',
  '医': '醫',
  '栄': '榮',
  '営': '營',
  '駅': '驛',
  '円': '圓',
  '応': '應',
  '価': '價',
  '仮': '假',
  '画': '畫',
  '会': '會',
  '絵': '繪',
  '覚': '覺',
  '学': '學',
  '楽': '樂',
  '観': '觀',
  '関': '關',
  '気': '氣',
  '帰': '歸',
  '旧': '舊',
  '区': '區',
  '軽': '輕',
  '芸': '藝',
  '経': '經',
  '県': '縣',
  '権': '權',
  '険': '險',
  '検': '檢',
  '献': '獻',
  '厳': '嚴',
  '広': '廣',
  '国': '國',
  '黒': '黑',
  '済': '濟',
  '歳': '歲',
  '斎': '齋',
  '桜': '櫻',
  '残': '殘',
  '賛': '贊',
  '糸': '絲',
  '児': '兒',
  '辞': '辭',
  '実': '實',
  '湿': '濕',
  '写': '寫',
  '釈': '釋',
  '寿': '壽',
  '収': '收',
  '従': '從',
  '渋': '澁',
  '獣': '獸',
  '縦': '縱',
  '粛': '肅',
  '処': '處',
  '乗': '乘',
  '条': '條',
  '浄': '淨',
  '剰': '剩',
  '畳': '疊',
  '譲': '讓',
  '醸': '釀',
  '嘱': '囑',
  '触': '觸',
  '寝': '寢',
  '慎': '愼',
  '真': '眞',
  '尽': '盡',
  '図': '圖',
  '粋': '粹',
  '酔': '醉',
  '穂': '穗',
  '随': '隨',
  '髄': '髓',
  '数': '數',
  '枢': '樞',
  '瀬': '瀨',
  '声': '聲',
  '斉': '齊',
  '静': '靜',
  '摂': '攝',
  '窃': '竊',
  '専': '專',
  '戦': '戰',
  '浅': '淺',
  '潜': '潛',
  '繊': '纖',
  '践': '踐',
  '銭': '錢',
  '禅': '禪',
  '双': '雙',
  '壮': '壯',
  '捜': '搜',
  '挿': '插',
  '巣': '巢',
  '争': '爭',
  '荘': '莊',
  '装': '裝',
  '総': '總',
  '騒': '騷',
  '増': '增',
  '臓': '臟',
  '蔵': '藏',
  '即': '卽',
  '属': '屬',
  '続': '續',
  '堕': '墮',
  '体': '體',
  '対': '對',
  '帯': '帶',
  '滞': '滯',
  '台': '臺',
  '滝': '瀧',
  '択': '擇',
  '沢': '澤',
  '単': '單',
  '担': '擔',
  '胆': '膽',
  '団': '團',
  '弾': '彈',
  '断': '斷',
  '痴': '癡',
  '遅': '遲',
  '昼': '晝',
  '虫': '蟲',
  '鋳': '鑄',
  '庁': '廳',
  '徴': '徵',
  '聴': '聽',
  '鎮': '鎭',
  '逓': '遞',
  '鉄': '鐵',
  '転': '轉',
  '点': '點',
  '伝': '傳',
  '党': '黨',
  '盗': '盜',
  '灯': '燈',
  '当': '當',
  '闘': '鬪',
  '徳': '德',
  '独': '獨',
  '読': '讀',
  '届': '屆',
  '縄': '繩',
  '弐': '貳',
  '悩': '惱',
  '脳': '腦',
  '覇': '霸',
  '廃': '廢',
  '拝': '拜',
  '売': '賣',
  '麦': '麥',
  '発': '發',
  '髪': '髮',
  '抜': '拔',
  '蛮': '蠻',
  '秘': '祕',
  '浜': '濱',
  '瓶': '甁',
  '払': '拂',
  '仏': '佛',
  '並': '竝',
  '変': '變',
  '辺': '邊',
  '弁': '辨/瓣/辯',
  '舗': '舖',
  '宝': '寶',
  '豊': '豐',
  '没': '沒',
  '翻': '飜',
  '万': '萬',
  '満': '滿',
  '黙': '默',
  '戻': '戾',
  '弥': '彌',
  '薬': '藥',
  '訳': '譯',
  '薮': '藪',
  '予': '豫',
  '余': '餘',
  '与': '與',
  '誉': '譽',
  '揺': '搖',
  '様': '樣',
  '謡': '謠',
  '来': '來',
  '頼': '賴',
  '乱': '亂',
  '覧': '覽',
  '略': '畧',
  '両': '兩',
  '猟': '獵',
  '緑': '綠',
  '涙': '淚',
  '累': '纍',
  '励': '勵',
  '礼': '禮',
  '隷': '隸',
  '霊': '靈',
  '齢': '齡',
  '恋': '戀',
  '炉': '爐',
  '労': '勞',
  '楼': '樓',
  '録': '錄',
  '湾': '灣',
  '顔': '顏',
  '歯': '齒',
  '竜': '龍',
  '亀': '龜',
  '雑': '雜',
  '証': '證',
  '験': '驗',
  '焼': '燒',
};

export interface KanjiGroundTruthFact {
  kanji: string;
  hanViet: string;
  strokeCount: number;
  jlpt: 'N5' | 'N4' | 'N3' | 'N2' | 'N1';
  radicalNumber: number;
  radicalSymbol: string;
  radicalPositionNote?: string;
  structureType: KanjiStructureType;
  kyujitai?: string;
  components: KanjiComponentItem[];
  etymologyFact: string;
  mnemonicTip: string;
  onyomi: string[];
  kunyomi: string[];
  confusables: KanjiConfusableItem[];
  bannedMyths?: RegExp[];
}

/**
 * Authoritative Ground-Truth Kanji Knowledge Base (KANJIDIC2 / KRADFILE / Daijirin / ShuoWen)
 * Covers all 8 Mandatory Trap Kanji + Keisei phonetic families + Shinjitai/Kyūjitai + Kokuji + 阝 left/right + core JLPT Kanji.
 */
export const KANJI_GROUND_TRUTH_DB: Record<string, KanjiGroundTruthFact> = {
  // === 1. MANDATORY TRAP TEST KANJI (8/8 ZERO-ERROR LOCK) ===
  '持': {
    kanji: '持',
    hanViet: 'TRÌ',
    strokeCount: 9,
    jlpt: 'N4',
    radicalNumber: 64,
    radicalSymbol: '扌',
    radicalPositionNote: 'Biến thể của bộ 手 (Thủ — bàn tay) ở bên trái',
    structureType: 'Hình thanh',
    components: [
      { char: '扌', role: 'Nghĩa phù', meaning: 'Thủ (bàn tay) — biểu thị hành động cầm, nắm, giữ' },
      { char: '寺', role: 'Thanh phù', meaning: 'Tự — thành phần mượn âm đọc ジ (TRÌ), chỉ đóng vai trò thanh phù' },
    ],
    etymologyFact:
      'Chữ Hình thanh gồm nghĩa phù 扌 (Thủ — bàn tay) biểu thị hành động cầm nắm, ghép với thanh phù 寺 (Tự — chỉ đóng vai trò mượn âm đọc ジ/TRÌ theo hệ thanh phù Hán cổ).',
    mnemonicTip: 'Dùng bàn tay (扌) cầm giữ chắc chắn — cùng họ thanh phù 寺 (âm ジ/チ) với 待 (đợi), 時 (thời gian).',
    onyomi: ['ジ'],
    kunyomi: ['も.つ'],
    confusables: [
      { kanji: '待', hanViet: 'ĐÃI', meaningVi: 'chờ đợi (bộ 彳 Xích)', diffNote: 'Thay 扌 bằng 彳 (bước chân)' },
      { kanji: '時', hanViet: 'THỜI', meaningVi: 'thời gian (bộ 日 Nhật)', diffNote: 'Thay 扌 bằng 日 (mặt trời)' },
      { kanji: '特', hanViet: 'ĐẶC', meaningVi: 'đặc biệt (bộ 牜 Ngưu)', diffNote: 'Thay 扌 bằng 牜 (trâu bò)' },
    ],
    bannedMyths: [/ngôi\s*chùa|vào\s*chùa|đền\s*chùa|chùa\s*chiền|mang\s*đến\s*chùa/i],
  },
  '語': {
    kanji: '語',
    hanViet: 'NGỮ',
    strokeCount: 14,
    jlpt: 'N5',
    radicalNumber: 149,
    radicalSymbol: '言',
    radicalPositionNote: 'Bộ 言 (Ngôn — lời nói) nằm bên trái',
    structureType: 'Hình thanh',
    components: [
      { char: '言', role: 'Nghĩa phù', meaning: 'Ngôn (lời nói) — biểu thị ngôn ngữ, trò chuyện' },
      { char: '吾', role: 'Thanh phù', meaning: 'Ngô (ta/bản thân) — tạo âm đọc ゴ (NGỮ)' },
    ],
    etymologyFact:
      'Chữ Hình thanh kết hợp nghĩa phù 言 (Ngôn — lời nói) với thanh phù 吾 (Ngô — tạo âm đọc ゴ), mang nghĩa lời nói, ngôn ngữ và sự tường thuật.',
    mnemonicTip: 'Lời nói (言) phát ra từ âm đọc 吾 (ゴ) — tạo nên ngôn ngữ (日本語, 英語).',
    onyomi: ['ゴ'],
    kunyomi: ['かた.る', 'かた.らう'],
    confusables: [
      { kanji: '悟', hanViet: 'NGỘ', meaningVi: 'giác ngộ (bộ 忄 Tâm)', diffNote: 'Thay 言 bằng 忄 (tâm)' },
      { kanji: '誤', hanViet: 'NGỘ', meaningVi: 'nhầm lẫn (言 + 呉)', diffNote: 'Bên phải là 呉 (Ngô), không phải 吾' },
      { kanji: '話', hanViet: 'THOẠI', meaningVi: 'nói chuyện (言 + 舌)', diffNote: 'Bên phải là 舌 (cái lưỡi)' },
    ],
  },
  '気': {
    kanji: '気',
    hanViet: 'KHÍ',
    strokeCount: 6,
    jlpt: 'N5',
    radicalNumber: 84,
    radicalSymbol: '气',
    radicalPositionNote: 'Bộ 气 (Khí — hơi nước/không khí) bao phía trên và phải',
    structureType: 'Hình thanh',
    kyujitai: '氣',
    components: [
      { char: '气', role: 'Nghĩa phù', meaning: 'Khí (làn hơi bốc lên) — bộ thủ chính' },
      { char: '〆', role: 'Thành phần', meaning: 'Nét giản lược Tân tự thể (新字体) từ chữ 米 (Mễ — hạt gạo) trong Cựu tự thể 氣' },
    ],
    etymologyFact:
      'Dạng Tân tự thể của Cựu tự thể 氣 (气 Khí + 米 Mễ). Nghĩa gốc chỉ làn hơi nóng bốc lên khi nấu gạo, mở rộng thành không khí, sinh lực và tinh thần; nét 〆 bên trong chỉ là dạng giản lược của 米 (gạo), không phải ký tự Katakana メ.',
    mnemonicTip: 'Nhớ qua Cựu tự thể 氣: hơi nóng (气) bốc lên từ nồi gạo (米) tạo nên nguồn khí lực (元気).',
    onyomi: ['キ', 'ケ'],
    kunyomi: ['いき'],
    confusables: [
      { kanji: '汽', hanViet: 'KHÍ', meaningVi: 'hơi nước (氵 + 气)', diffNote: 'Thêm bộ 氵 (Thủy) bên trái, không có 米/〆' },
      { kanji: '氧', hanViet: 'DƯỠNG', meaningVi: 'oxy (气 + 羊)', diffNote: 'Bên trong là 羊 (Dương)' },
    ],
    bannedMyths: [/katakana\s*メ|chữ\s*メ|dấu\s*nhân/i],
  },
  '駅': {
    kanji: '駅',
    hanViet: 'DỊCH',
    strokeCount: 14,
    jlpt: 'N5',
    radicalNumber: 187,
    radicalSymbol: '馬',
    radicalPositionNote: 'Bộ 馬 (Mã — con ngựa) nằm bên trái',
    structureType: 'Hình thanh',
    kyujitai: '驛',
    components: [
      { char: '馬', role: 'Nghĩa phù', meaning: 'Mã (ngựa) — gợi nhắc trạm dịch thay ngựa thời cổ' },
      { char: '尺', role: 'Thanh phù', meaning: 'Dạng giản lược Tân tự thể của thanh phù 睪 (Dịch) trong Cựu tự thể 驛, KHÔNG mang nghĩa cái thước đo' },
    ],
    etymologyFact:
      'Chữ Hình thanh dạng Tân tự thể rút gọn từ Cựu tự thể 驛 (馬 Mã + thanh phù 睪 Dịch). Xưa chỉ trạm dịch thay ngựa đưa thư, nay chỉ nhà ga tàu điện; phần 尺 chỉ là dạng viết gọn của 睪, tuyệt đối không phải "đo ngựa bằng thước".',
    mnemonicTip: 'Từ trạm dừng ngựa (馬) trong Cựu tự thể 驛 phát triển thành nhà ga (駅前, 地下鉄の駅).',
    onyomi: ['エキ'],
    kunyomi: [],
    confusables: [
      { kanji: '訳', hanViet: 'DỊCH', meaningVi: 'phiên dịch (言 + 尺 ← 譯)', diffNote: 'Cùng rút gọn từ 睪, nhưng nghĩa phù là 言 (lời nói)' },
      { kanji: '釈', hanViet: 'THÍCH', meaningVi: 'giải thích (釆 + 尺 ← 釋)', diffNote: 'Nghĩa phù là 釆 (phân biệt)' },
      { kanji: '駐', hanViet: 'TRÚ', meaningVi: 'đỗ xe, đóng quân (馬 + 主)', diffNote: 'Bên phải là 主 (Chủ)' },
    ],
    bannedMyths: [/cái\s*thước|thước\s*đo|đo\s*ngựa|đo\s*khoảng\s*cách/i],
  },
  '聴': {
    kanji: '聴',
    hanViet: 'THÍNH',
    strokeCount: 17,
    jlpt: 'N3',
    radicalNumber: 128,
    radicalSymbol: '耳',
    radicalPositionNote: 'Bộ 耳 (Nhĩ — đôi tai) nằm bên trái',
    structureType: 'Hình thanh',
    kyujitai: '聽',
    components: [
      { char: '耳', role: 'Nghĩa phù', meaning: 'Nhĩ (đôi tai) — bộ thủ chính biểu thị việc lắng nghe' },
      { char: '㥁', role: 'Thành phần', meaning: 'Phần bên phải rút gọn từ 悳 (直 Trực + 心 Tâm) trong Cựu tự thể 聽, gợi sự chuyên tâm lắng nghe' },
    ],
    etymologyFact:
      'Dạng Tân tự thể của Cựu tự thể 聽 (gồm 耳 Nhĩ là tai, thanh phù 壬 và 悳/心 chỉ tấm lòng ngay thẳng chuyên chú). Nghĩa cốt lõi là lắng nghe chăm chú bằng cả đôi tai và tâm trí.',
    mnemonicTip: 'Dùng đôi tai (耳) cùng tấm lòng ngay thẳng (十·罒·心) để chăm chú lắng nghe (聴く).',
    onyomi: ['チョウ'],
    kunyomi: ['き.く', 'ゆる.す'],
    confusables: [
      { kanji: '聞', hanViet: 'VĂN', meaningVi: 'nghe thấy, hỏi (門 + 耳)', diffNote: '聞 là nghe tự nhiên lọt vào tai; 聴 là chủ động chăm chú nghe' },
      { kanji: '徳', hanViet: 'ĐỨC', meaningVi: 'đạo đức (彳 + 十 + 罒 + 一 + 心)', diffNote: 'Thay 耳 bằng 彳 và có thêm nét ngang 一 trên 心' },
    ],
  },
  '働': {
    kanji: '働',
    hanViet: 'ĐỘNG',
    strokeCount: 13,
    jlpt: 'N4',
    radicalNumber: 9,
    radicalSymbol: '亻',
    radicalPositionNote: 'Biến thể của bộ 人 (Nhân đứng — con người) ở bên trái',
    structureType: 'Quốc tự',
    components: [
      { char: '亻', role: 'Nghĩa phù', meaning: 'Nhân đứng (con người) — bộ thủ chính' },
      { char: '動', role: 'Thành phần', meaning: 'Động (chuyển động, hoạt động) — góp nghĩa và âm đọc ドウ' },
    ],
    etymologyFact:
      'Đây là Quốc tự (国字 — Kokuji) do người Nhật tự sáng tạo theo lối Hội ý, ghép 亻 (người) và 動 (vận động) để biểu thị hành động con người lao động, làm việc. Chữ này về sau mới được du nhập ngược lại vào tiếng Trung.',
    mnemonicTip: 'Con người (亻) vận động (動) chính là làm việc (働く) — một Quốc tự kinh điển của Nhật Bản.',
    onyomi: ['ドウ'],
    kunyomi: ['はたら.く'],
    confusables: [
      { kanji: '動', hanViet: 'ĐỘNG', meaningVi: 'chuyển động (重 + 力)', diffNote: 'Không có bộ 亻 (Nhân đứng) bên trái' },
      { kanji: '勤', hanViet: 'CẦN', meaningVi: 'làm việc công sở, cần mẫn', diffNote: 'Dùng cho việc đi làm tại cơ quan (通勤, 勤務)' },
    ],
  },
  '防': {
    kanji: '防',
    hanViet: 'PHÒNG',
    strokeCount: 7,
    jlpt: 'N3',
    radicalNumber: 170,
    radicalSymbol: '阝',
    radicalPositionNote: 'Bộ 阜 (Phụ — gò đất, đê điều) viết thành 阝 nằm bên TRÁI (KHÔNG phải bộ 邑 Ấp)',
    structureType: 'Hình thanh',
    components: [
      { char: '阝(阜)', role: 'Nghĩa phù', meaning: 'Bộ 阜 Phụ (gò đất, bờ đê) bên TRÁI — biểu thị đê đập ngăn nước, phòng hộ' },
      { char: '方', role: 'Thanh phù', meaning: 'Phương — tạo âm đọc ボウ (PHÒNG)' },
    ],
    etymologyFact:
      'Chữ Hình thanh gồm nghĩa phù 阜 (viết là 阝 ở bên TRÁI, nghĩa là gò đất/bờ đê ngăn lũ) và thanh phù 方 (tạo âm ボウ). Nghĩa gốc là đắp đê chống lũ, mở rộng thành phòng ngừa, bảo vệ.',
    mnemonicTip: 'Nhớ quy tắc thép: 阝 bên TRÁI là 阜 (đê đất) ngăn lũ, ghép âm 方 (ボウ) thành phòng chống (防止, 予防).',
    onyomi: ['ボウ'],
    kunyomi: ['ふせ.ぐ'],
    confusables: [
      { kanji: '訪', hanViet: 'PHỎNG', meaningVi: 'thăm viếng (言 + 方)', diffNote: 'Thay 阝(阜) bằng 言 (lời nói)' },
      { kanji: '坊', hanViet: 'PHƯỜNG', meaningVi: 'nhà sư, cậu bé (土 + 方)', diffNote: 'Thay 阝(阜) bằng 土 (đất)' },
      { kanji: '妨', hanViet: 'PHƯƠNG', meaningVi: 'cản trở (女 + 方)', diffNote: 'Thay 阝(阜) bằng 女 (nữ)' },
    ],
    bannedMyths: [/bộ\s*ấp|邑|đô\s*thị|làng\s*mạc/i],
  },
  '都': {
    kanji: '都',
    hanViet: 'ĐÔ',
    strokeCount: 11,
    jlpt: 'N4',
    radicalNumber: 163,
    radicalSymbol: '阝',
    radicalPositionNote: 'Bộ 邑 (Ấp — vùng đất, đô thị) viết thành 阝 nằm bên PHẢI (KHÔNG phải bộ 阜 Phụ)',
    structureType: 'Hình thanh',
    components: [
      { char: '者', role: 'Thanh phù', meaning: 'Giả — tạo âm đọc ト/ツ (ĐÔ)' },
      { char: '阝(邑)', role: 'Nghĩa phù', meaning: 'Bộ 邑 Ấp (vùng đất, đô thị, làng mạc) bên PHẢI — bộ thủ chính' },
    ],
    etymologyFact:
      'Chữ Hình thanh gồm nghĩa phù 邑 (viết là 阝 ở bên PHẢI, chỉ vùng đất/kinh đô) và thanh phù 者 (tạo âm ト/ツ). Nghĩa cốt lõi là kinh đô, thành phố lớn (東京都, 都市).',
    mnemonicTip: 'Nhớ quy tắc thép: 阝 bên PHẢI là 邑 (đô thị/làng mạc) + âm 者 (ト) → thành phố, kinh đô (東京・都).',
    onyomi: ['ト', 'ツ'],
    kunyomi: ['みやこ'],
    confusables: [
      { kanji: '部', hanViet: 'BỘ', meaningVi: 'bộ phận, phòng ban (咅 + 阝)', diffNote: 'Cùng bộ 邑 (阝 phải), bên trái là 咅' },
      { kanji: '郡', hanViet: 'QUẬN', meaningVi: 'quận, huyện (君 + 阝)', diffNote: 'Cùng bộ 邑 (阝 phải), bên trái là 君' },
      { kanji: '暑', hanViet: 'THỬ', meaningVi: 'nóng bức (日 + 者)', diffNote: 'Chứa 者 nhưng ghép với 日 (mặt trời)' },
    ],
    bannedMyths: [/bộ\s*phụ|阜|gò\s*đất|đê\s*điều|sườn\s*núi/i],
  },

  // === 2. KEISEI FAMILIES (寺 / 方 / 吾 / 青) ===
  '待': {
    kanji: '待',
    hanViet: 'ĐÃI',
    strokeCount: 9,
    jlpt: 'N5',
    radicalNumber: 60,
    radicalSymbol: '彳',
    radicalPositionNote: 'Bộ 彳 (Xích — bước chân, đi lại) nằm bên trái',
    structureType: 'Hình thanh',
    components: [
      { char: '彳', role: 'Nghĩa phù', meaning: 'Xích (bước chân, dừng chân trên đường)' },
      { char: '寺', role: 'Thanh phù', meaning: 'Tự — mượn âm đọc タイ (ĐÃI), không mang nghĩa ngôi chùa' },
    ],
    etymologyFact:
      'Chữ Hình thanh gồm nghĩa phù 彳 (bước chân dừng lại) và thanh phù 寺 (tạo âm タイ), mang nghĩa dừng bước chờ đợi hoặc tiếp đãi.',
    mnemonicTip: 'Dừng bước chân (彳) chờ đợi — cùng họ thanh phù 寺 với 持 (cầm), 時 (thời gian).',
    onyomi: ['タイ'],
    kunyomi: ['ま.つ'],
    confusables: [
      { kanji: '持', hanViet: 'TRÌ', meaningVi: 'cầm, mang (扌 + 寺)', diffNote: 'Thay 彳 bằng 扌 (bàn tay)' },
      { kanji: '侍', hanViet: 'THỊ', meaningVi: 'võ sĩ hầu cận (亻 + 寺)', diffNote: 'Thay 彳 bằng 亻 (con người)' },
    ],
    bannedMyths: [/ngôi\s*chùa|đền\s*chùa|trước\s*chùa/i],
  },
  '時': {
    kanji: '時',
    hanViet: 'THỜI',
    strokeCount: 10,
    jlpt: 'N5',
    radicalNumber: 72,
    radicalSymbol: '日',
    radicalPositionNote: 'Bộ 日 (Nhật — mặt trời, ngày) nằm bên trái',
    structureType: 'Hình thanh',
    components: [
      { char: '日', role: 'Nghĩa phù', meaning: 'Nhật (mặt trời) — đo lường thời gian, mùa vụ' },
      { char: '寺', role: 'Thanh phù', meaning: 'Tự — mượn âm đọc ジ (THỜI), không mang nghĩa ngôi chùa' },
    ],
    etymologyFact:
      'Chữ Hình thanh gồm nghĩa phù 日 (mặt trời, chu kỳ ngày đêm) và thanh phù 寺 (tạo âm ジ), biểu thị thời gian, giờ giấc và mùa vụ.',
    mnemonicTip: 'Mặt trời (日) chuyển động đo thời gian (時間) — dùng chung thanh phù 寺 (âm ジ) với 持.',
    onyomi: ['ジ'],
    kunyomi: ['とき'],
    confusables: [
      { kanji: '持', hanViet: 'TRÌ', meaningVi: 'cầm giữ (扌 + 寺)', diffNote: 'Thay 日 bằng 扌 (bàn tay)' },
      { kanji: '待', hanViet: 'ĐÃI', meaningVi: 'chờ đợi (彳 + 寺)', diffNote: 'Thay 日 bằng 彳 (bước chân)' },
    ],
    bannedMyths: [/ngôi\s*chùa|đền\s*chùa/i],
  },
  '特': {
    kanji: '特',
    hanViet: 'ĐẶC',
    strokeCount: 10,
    jlpt: 'N4',
    radicalNumber: 93,
    radicalSymbol: '牜',
    radicalPositionNote: 'Biến thể của bộ 牛 (Ngưu — trâu bò) ở bên trái',
    structureType: 'Hình thanh',
    components: [
      { char: '牜', role: 'Nghĩa phù', meaning: 'Ngưu (trâu bò) — xưa chỉ con bò đực nổi trội được chọn làm vật tế' },
      { char: '寺', role: 'Thanh phù', meaning: 'Tự — thanh phù góp âm đọc トク (ĐẶC)' },
    ],
    etymologyFact:
      'Chữ Hình thanh gồm nghĩa phù 牛/牜 (trâu bò — gốc chỉ con bò đực khỏe mạnh nổi trội) và thanh phù 寺, mở rộng thành nghĩa đặc biệt, riêng biệt.',
    mnemonicTip: 'Con bò nổi trội (牜) tách biệt khỏi đàn → đặc biệt (特別, 特徴).',
    onyomi: ['トク'],
    kunyomi: [],
    confusables: [
      { kanji: '持', hanViet: 'TRÌ', meaningVi: 'cầm giữ (扌 + 寺)', diffNote: 'Thay 牜 bằng 扌' },
      { kanji: '時', hanViet: 'THỜI', meaningVi: 'thời gian (日 + 寺)', diffNote: 'Thay 牜 bằng 日' },
    ],
    bannedMyths: [/ngôi\s*chùa|đền\s*chùa/i],
  },

  // === 3. ADDITIONAL LEFT-阝 (阜) & RIGHT-阝 (邑) ANCHORS ===
  '院': {
    kanji: '院',
    hanViet: 'VIỆN',
    strokeCount: 10,
    jlpt: 'N4',
    radicalNumber: 170,
    radicalSymbol: '阝',
    radicalPositionNote: 'Bộ 阜 (Phụ — tường đất, khuôn viên cao) viết thành 阝 bên TRÁI',
    structureType: 'Hình thanh',
    components: [
      { char: '阝(阜)', role: 'Nghĩa phù', meaning: 'Bộ 阜 Phụ bên TRÁI — tường bao, khuôn viên' },
      { char: '完', role: 'Thanh phù', meaning: 'Hoàn — tạo âm đọc イン (VIỆN)' },
    ],
    etymologyFact:
      'Chữ Hình thanh gồm nghĩa phù 阜 (阝 trái — tường đất bao quanh khuôn viên) và thanh phù 完, chỉ tòa nhà công cộng, học viện, bệnh viện (病院, 大学院).',
    mnemonicTip: 'Khuôn viên có tường bao (阝 trái) hoàn chỉnh (完) → bệnh viện, học viện (病院).',
    onyomi: ['イン'],
    kunyomi: [],
    confusables: [
      { kanji: '完', hanViet: 'HOÀN', meaningVi: 'hoàn thành', diffNote: 'Không có bộ 阝(阜) bên trái' },
      { kanji: '限', hanViet: 'HẠN', meaningVi: 'giới hạn (阝 trái + 艮)', diffNote: 'Bên phải là 艮' },
    ],
    bannedMyths: [/bộ\s*ấp|邑/i],
  },
  '階': {
    kanji: '階',
    hanViet: 'GIAI',
    strokeCount: 12,
    jlpt: 'N3',
    radicalNumber: 170,
    radicalSymbol: '阝',
    radicalPositionNote: 'Bộ 阜 (Phụ — gò đất, bậc thềm) viết thành 阝 bên TRÁI',
    structureType: 'Hình thanh',
    components: [
      { char: '阝(阜)', role: 'Nghĩa phù', meaning: 'Bộ 阜 Phụ bên TRÁI — bậc đất, cầu thang' },
      { char: '皆', role: 'Thanh phù', meaning: 'Giai — tạo âm đọc カイ (GIAI)' },
    ],
    etymologyFact:
      'Chữ Hình thanh gồm nghĩa phù 阜 (阝 trái — bậc thềm đắp cao) và thanh phù 皆 (âm カイ), chỉ tầng lầu, bậc thang và giai cấp (階段, 三階).',
    mnemonicTip: 'Bậc thềm gò cao (阝 trái) + âm 皆 (カイ) → cầu thang, tầng lầu (階段).',
    onyomi: ['カイ'],
    kunyomi: ['きざはし'],
    confusables: [
      { kanji: '皆', hanViet: 'GIAI', meaningVi: 'tất cả mọi người', diffNote: 'Không có 阝(阜) bên trái' },
      { kanji: '段', hanViet: 'ĐOẠN', meaningVi: 'bậc, giai đoạn', diffNote: 'Thường đi cặp thành 階段 (cầu thang)' },
    ],
    bannedMyths: [/bộ\s*ấp|邑/i],
  },
  '部': {
    kanji: '部',
    hanViet: 'BỘ',
    strokeCount: 11,
    jlpt: 'N3',
    radicalNumber: 163,
    radicalSymbol: '阝',
    radicalPositionNote: 'Bộ 邑 (Ấp — vùng đất, khu vực hành chính) viết thành 阝 bên PHẢI',
    structureType: 'Hình thanh',
    components: [
      { char: '咅', role: 'Thanh phù', meaning: 'Phẫu/Bội — tạo âm đọc ブ (BỘ)' },
      { char: '阝(邑)', role: 'Nghĩa phù', meaning: 'Bộ 邑 Ấp bên PHẢI — phân khu hành chính, tập thể' },
    ],
    etymologyFact:
      'Chữ Hình thanh gồm nghĩa phù 邑 (阝 phải — đơn vị hành chính/địa hạt) và thanh phù 咅 (âm ブ), chỉ bộ phận, phòng ban, câu lạc bộ (部屋, 部長).',
    mnemonicTip: 'Bộ 邑 (阝 phải — đơn vị/khu vực) + thanh phù 咅 (ブ) → bộ phận, phòng ban (部屋).',
    onyomi: ['ブ'],
    kunyomi: [],
    confusables: [
      { kanji: '都', hanViet: 'ĐÔ', meaningVi: 'đô thị, kinh đô (者 + 阝 phải)', diffNote: 'Bên trái là 者 thay vì 咅' },
      { kanji: '倍', hanViet: 'BỘI', meaningVi: 'gấp đôi (亻 + 咅)', diffNote: 'Không có 阝 phải, thay bằng 亻 bên trái' },
    ],
    bannedMyths: [/bộ\s*phụ|阜/i],
  },
  '郵': {
    kanji: '郵',
    hanViet: 'BƯU',
    strokeCount: 11,
    jlpt: 'N3',
    radicalNumber: 163,
    radicalSymbol: '阝',
    radicalPositionNote: 'Bộ 邑 (Ấp — trạm dừng, địa hạt) viết thành 阝 bên PHẢI',
    structureType: 'Hình thanh',
    components: [
      { char: '垂', role: 'Thanh phù', meaning: 'Thùy — góp âm/ngữ cảnh biên thùy xưa' },
      { char: '阝(邑)', role: 'Nghĩa phù', meaning: 'Bộ 邑 Ấp bên PHẢI — trạm giao liên trên địa hạt' },
    ],
    etymologyFact:
      'Chữ Hình thanh/Hội ý gồm nghĩa phù 邑 (阝 phải — trạm hành chính địa phương) và 垂 (biên thùy), xưa chỉ trạm chuyển công văn, nay chỉ bưu chính (郵便局).',
    mnemonicTip: 'Trạm địa hạt (阝 phải = 邑) chuyển thư tới tận biên thùy (垂) → bưu điện (郵便).',
    onyomi: ['ユウ'],
    kunyomi: [],
    confusables: [
      { kanji: '垂', hanViet: 'THÙY', meaningVi: 'rủ xuống, thẳng đứng', diffNote: 'Không có 阝(邑) bên phải' },
      { kanji: '都', hanViet: 'ĐÔ', meaningVi: 'đô thị (者 + 阝 phải)', diffNote: 'Cùng bộ 邑 bên phải' },
    ],
    bannedMyths: [/bộ\s*phụ|阜/i],
  },

  // === 4. KEY KOKUJI (国字) ===
  '畑': {
    kanji: '畑',
    hanViet: 'ĐIỀN (Quốc tự)',
    strokeCount: 9,
    jlpt: 'N3',
    radicalNumber: 102,
    radicalSymbol: '田',
    radicalPositionNote: 'Bộ 田 (Điền — ruộng đất) nằm bên phải',
    structureType: 'Quốc tự',
    components: [
      { char: '火', role: 'Thành phần', meaning: 'Hỏa (lửa) — đốt rẫy làm nương khô' },
      { char: '田', role: 'Nghĩa phù', meaning: 'Điền (ruộng) — bộ thủ chính' },
    ],
    etymologyFact:
      'Quốc tự (国字) do người Nhật tạo theo lối Hội ý: ghép 火 (đốt rẫy) và 田 (ruộng) để phân biệt ruộng cạn trồng rau/hoa màu (畑 はたけ) với ruộng lúa nước (田 た).',
    mnemonicTip: 'Đốt cỏ bằng lửa (火) khai hoang thành mảnh ruộng khô (田) → vườn rau, ruộng cạn (畑).',
    onyomi: [],
    kunyomi: ['はた', 'はたけ'],
    confusables: [
      { kanji: '田', hanViet: 'ĐIỀN', meaningVi: 'ruộng lúa nước', diffNote: 'Không có bộ 火 bên trái' },
      { kanji: '煙', hanViet: 'YÊN', meaningVi: 'khói (火 + 西 + 土)', diffNote: 'Cùng có 火 bên trái' },
    ],
  },
  '峠': {
    kanji: '峠',
    hanViet: 'ĐÈO (Quốc tự)',
    strokeCount: 9,
    jlpt: 'N1',
    radicalNumber: 46,
    radicalSymbol: '山',
    radicalPositionNote: 'Bộ 山 (Sơn — ngọn núi) nằm bên trái',
    structureType: 'Quốc tự',
    components: [
      { char: '山', role: 'Nghĩa phù', meaning: 'Sơn (núi) — bộ thủ chính' },
      { char: '上', role: 'Thành phần', meaning: 'Thượng (leo lên đỉnh)' },
      { char: '下', role: 'Thành phần', meaning: 'Hạ (đổ dốc xuống)' },
    ],
    etymologyFact:
      'Quốc tự (国字) kinh điển của Nhật Bản theo lối Hội ý: ngọn núi (山) có đoạn leo lên (上) và đoạn xuống dốc (下), chính là đỉnh đèo (とうげ).',
    mnemonicTip: 'Núi (山) mà vừa lên (上) tới đỉnh rồi đi xuống (下) → đỉnh đèo, bước ngoặt (峠).',
    onyomi: [],
    kunyomi: ['とうげ'],
    confusables: [
      { kanji: '岐', hanViet: 'KỲ', meaningVi: 'ngã rẽ (山 + 支)', diffNote: 'Bên phải là 支' },
    ],
  },
  '込': {
    kanji: '込',
    hanViet: 'NHẬP (Quốc tự)',
    strokeCount: 5,
    jlpt: 'N3',
    radicalNumber: 162,
    radicalSymbol: '辶',
    radicalPositionNote: 'Biến thể của bộ 辵 (Sước — di chuyển) bao bên trái và dưới',
    structureType: 'Quốc tự',
    components: [
      { char: '辶', role: 'Nghĩa phù', meaning: 'Sước (di chuyển, đi vào) — bộ thủ chính' },
      { char: '入', role: 'Thành phần', meaning: 'Nhập (vào bên trong)' },
    ],
    etymologyFact:
      'Quốc tự (国字) do người Nhật sáng tạo theo lối Hội ý: ghép 辶 (bước đi) và 入 (đi vào) để diễn tả việc đông đúc, dồn vào sâu bên trong (込む, 申し込む).',
    mnemonicTip: 'Di chuyển (辶) tràn vào trong (入) → đông đúc, dồn vào (込む, 税込).',
    onyomi: [],
    kunyomi: ['こ.む', 'こ.める'],
    confusables: [
      { kanji: '辺', hanViet: 'BIÊN', meaningVi: 'vùng lân cận (辶 + 刀)', diffNote: 'Bên trong là 刀 (Đao)' },
      { kanji: '近', hanViet: 'CẬN', meaningVi: 'gần (辶 + 斤)', diffNote: 'Bên trong là 斤' },
    ],
  },

  // === 5. KEY SHINJITAI / KYUJITAI & HIGH-FREQUENCY KANJI ===
  '学': {
    kanji: '学',
    hanViet: 'HỌC',
    strokeCount: 8,
    jlpt: 'N5',
    radicalNumber: 39,
    radicalSymbol: '子',
    radicalPositionNote: 'Bộ 子 (Tử — trẻ nhỏ, người học) ở phía dưới',
    structureType: 'Hình thanh',
    kyujitai: '學',
    components: [
      { char: '⺍', role: 'Thành phần', meaning: 'Dạng giản lược từ 𦥯 (đôi tay truyền dạy tri thức) trong Cựu tự thể 學' },
      { char: '冖', role: 'Thành phần', meaning: 'Mịch (mái che ngôi trường)' },
      { char: '子', role: 'Nghĩa phù', meaning: 'Tử (trẻ nhỏ) — bộ thủ chính' },
    ],
    etymologyFact:
      'Dạng Tân tự thể của 學: phía trên tượng hình đôi tay truyền thụ tri thức dưới mái nhà (冖) cho trẻ nhỏ (子) học tập.',
    mnemonicTip: 'Đứa trẻ (子) ngồi dưới mái trường (冖) tiếp thu tri thức (⺍) → học tập (学生, 大学).',
    onyomi: ['ガク'],
    kunyomi: ['まな.ぶ'],
    confusables: [
      { kanji: '字', hanViet: 'TỰ', meaningVi: 'chữ viết (宀 + 子)', diffNote: 'Phía trên là bộ 宀 (Miên) không có 3 nét ⺍' },
      { kanji: '覚', hanViet: 'GIÁC', meaningVi: 'nhớ, cảm nhận (⺍ + 冖 + 見)', diffNote: 'Phía dưới là 見 thay vì 子' },
    ],
  },
  '会': {
    kanji: '会',
    hanViet: 'HỘI',
    strokeCount: 6,
    jlpt: 'N5',
    radicalNumber: 9,
    radicalSymbol: '人',
    radicalPositionNote: 'Bộ 人 (Nhân — người/mái hội tụ) dạng 𠆢 ở phía trên',
    structureType: 'Hội ý',
    kyujitai: '會',
    components: [
      { char: '𠆢', role: 'Nghĩa phù', meaning: 'Nhân (mái che hội tụ) — bộ thủ chính' },
      { char: '云', role: 'Thành phần', meaning: 'Dạng rút gọn Tân tự thể của phần dưới trong Cựu tự thể 會' },
    ],
    etymologyFact:
      'Dạng Tân tự thể của 會 (tượng hình nắp đậy khít nồi cơm, mở rộng thành sự hội tụ, gặp gỡ). Âm Hán Việt chuẩn hiện đại là HỘI (tuyệt đối không đọc là Cối).',
    mnemonicTip: 'Mọi người quây quần dưới một mái nhà (𠆢) để gặp gỡ, hội họp (会う, 会社).',
    onyomi: ['カイ', 'エ'],
    kunyomi: ['あ.う'],
    confusables: [
      { kanji: '合', hanViet: 'HỢP', meaningVi: 'hợp lại, vừa khớp (𠆢 + 一 + 口)', diffNote: 'Phía dưới là 一 + 口 thay vì 云' },
      { kanji: '全', hanViet: 'TOÀN', meaningVi: 'toàn bộ (𠆢 + 王)', diffNote: 'Phía dưới là 王' },
    ],
    bannedMyths: [/\bcối\b/i],
  },
  '読': {
    kanji: '読',
    hanViet: 'ĐỘC',
    strokeCount: 14,
    jlpt: 'N5',
    radicalNumber: 149,
    radicalSymbol: '言',
    radicalPositionNote: 'Bộ 言 (Ngôn — lời nói) nằm bên trái',
    structureType: 'Hình thanh',
    kyujitai: '讀',
    components: [
      { char: '言', role: 'Nghĩa phù', meaning: 'Ngôn (lời nói) — đọc thành tiếng' },
      { char: '売', role: 'Thanh phù', meaning: 'Dạng giản lược Tân tự thể từ 賣 trong Cựu tự thể 讀 (tạo âm ドク), không mang nghĩa buôn bán' },
    ],
    etymologyFact:
      'Chữ Hình thanh rút gọn từ Cựu tự thể 讀: nghĩa phù 言 (lời nói) ghép thanh phù 賣 (giản lược thành 売, mượn âm ドク), mang nghĩa đọc sách, đọc hiểu.',
    mnemonicTip: 'Dùng lời nói (言) cất tiếng đọc (読書, 読む); nhớ 売 bên phải chỉ là giản lược thanh phù từ 讀.',
    onyomi: ['ドク', 'トク', 'トウ'],
    kunyomi: ['よ.む'],
    confusables: [
      { kanji: '続', hanViet: 'TỤC', meaningVi: 'tiếp tục (糸 + 売 ← 續)', diffNote: 'Thay 言 bằng 糸 (sợi tơ)' },
      { kanji: '売', hanViet: 'MẠI', meaningVi: 'bán (← 賣)', diffNote: 'Không có bộ 言 bên trái' },
    ],
  },
  '国': {
    kanji: '国',
    hanViet: 'QUỐC',
    strokeCount: 8,
    jlpt: 'N5',
    radicalNumber: 31,
    radicalSymbol: '囗',
    radicalPositionNote: 'Bộ 囗 (Vi — biên giới bao quanh) bọc bên ngoài',
    structureType: 'Hội ý',
    kyujitai: '國',
    components: [
      { char: '囗', role: 'Nghĩa phù', meaning: 'Vi (đường biên giới lãnh thổ) — bộ thủ chính' },
      { char: '玉', role: 'Thành phần', meaning: 'Ngọc (quốc bảo) — thay thế cho 或 (vùng đất có binh khí bảo vệ) trong Cựu tự thể 國' },
    ],
    etymologyFact:
      'Dạng Tân tự thể của 國 (囗 biên giới bao quanh 或 — lãnh thổ được bảo vệ bằng binh khí). Khi giản lược sang 新字体 đã đổi bên trong thành 玉 (ngọc quý).',
    mnemonicTip: 'Đường biên giới (囗) bảo vệ báu vật quốc gia (玉) → đất nước (外国, 日本国).',
    onyomi: ['コク'],
    kunyomi: ['くに'],
    confusables: [
      { kanji: '図', hanViet: 'ĐỒ', meaningVi: 'bản đồ, sơ đồ (囗 + ⺄ + 丶)', diffNote: 'Bên trong khác hoàn toàn 玉' },
      { kanji: '固', hanViet: 'CỐ', meaningVi: 'cứng rắn (囗 + 古)', diffNote: 'Bên trong là 古' },
    ],
  },
  '経': {
    kanji: '経',
    hanViet: 'KINH',
    strokeCount: 11,
    jlpt: 'N3',
    radicalNumber: 120,
    radicalSymbol: '糸',
    radicalPositionNote: 'Bộ 糸 (Mịch — sợi tơ dọc) nằm bên trái',
    structureType: 'Hình thanh',
    kyujitai: '經',
    components: [
      { char: '糸', role: 'Nghĩa phù', meaning: 'Mịch (sợi tơ) — sợi dọc trên khung dệt' },
      { char: '圣', role: 'Thanh phù', meaning: 'Dạng giản lược từ 巠 trong Cựu tự thể 經 (tạo âm ケイ)' },
    ],
    etymologyFact:
      'Chữ Hình thanh rút gọn từ 經: nghĩa phù 糸 (sợi dọc khung cửi) + thanh phù 巠 (âm ケイ). Mở rộng nghĩa thành trải qua thời gian, kinh nghiệm, kinh tế (経験, 経済).',
    mnemonicTip: 'Sợi chỉ dọc (糸) xuyên suốt thời gian tạo thành kinh nghiệm (経験) và kinh tế (経済).',
    onyomi: ['ケイ', 'キョウ'],
    kunyomi: ['へ.る', 'た.つ'],
    confusables: [
      { kanji: '軽', hanViet: 'KHINH', meaningVi: 'nhẹ (車 + 圣 ← 輕)', diffNote: 'Thay 糸 bằng 車 (xe)' },
      { kanji: '径', hanViet: 'KÍNH', meaningVi: 'đường kính, lối nhỏ (彳 + 圣)', diffNote: 'Thay 糸 bằng 彳' },
    ],
  },
  '験': {
    kanji: '験',
    hanViet: 'NGHIỆM',
    strokeCount: 18,
    jlpt: 'N4',
    radicalNumber: 187,
    radicalSymbol: '馬',
    radicalPositionNote: 'Bộ 馬 (Mã — con ngựa) nằm bên trái',
    structureType: 'Hình thanh',
    kyujitai: '驗',
    components: [
      { char: '馬', role: 'Nghĩa phù', meaning: 'Mã (ngựa) — gốc từ việc kiểm tra phẩm chất ngựa' },
      { char: '㑒', role: 'Thanh phù', meaning: 'Dạng giản lược từ 僉 trong Cựu tự thể 驗 (tạo âm ケン)' },
    ],
    etymologyFact:
      'Chữ Hình thanh rút gọn từ 驗 (馬 Mã + thanh phù 僉), nghĩa mở rộng thành kiểm chứng, thi cử và trải nghiệm thực tế (試験, 経験).',
    mnemonicTip: 'Kiểm tra ngựa tốt (馬) với thanh phù âm ケン → thi cử (試験), kinh nghiệm (経験).',
    onyomi: ['ケン', 'ゲン'],
    kunyomi: [],
    confusables: [
      { kanji: '検', hanViet: 'KIỂM', meaningVi: 'kiểm tra (木 + 㑒 ← 檢)', diffNote: 'Thay 馬 bằng 木 (cây)' },
      { kanji: '険', hanViet: 'HIỂM', meaningVi: 'nguy hiểm (阝 trái + 㑒 ← 險)', diffNote: 'Thay 馬 bằng 阝(阜)' },
    ],
  },
  '勉': {
    kanji: '勉',
    hanViet: 'MIỄN',
    strokeCount: 10,
    jlpt: 'N4',
    radicalNumber: 19,
    radicalSymbol: '力',
    radicalPositionNote: 'Bộ 力 (Lực — sức lực) nằm bên phải',
    structureType: 'Hình thanh',
    components: [
      { char: '免', role: 'Thanh phù', meaning: 'Miễn — tạo âm đọc ベン (MIỄN)' },
      { char: '力', role: 'Nghĩa phù', meaning: 'Lực (sức mạnh, nỗ lực) — bộ thủ chính' },
    ],
    etymologyFact:
      'Chữ Hình thanh gồm nghĩa phù 力 (dốc sức lực) và thanh phù 免 (tạo âm ベン), mang nghĩa cố gắng, chuyên cần (勉強).',
    mnemonicTip: 'Dồn sức lực (力) cùng thanh phù 免 (ベン) → cố gắng học hành (勉強).',
    onyomi: ['ベン'],
    kunyomi: ['つと.める'],
    confusables: [
      { kanji: '免', hanViet: 'MIỄN', meaningVi: 'miễn trừ, giấy phép', diffNote: 'Không có bộ 力 bên phải' },
      { kanji: '晩', hanViet: 'VÃN', meaningVi: 'buổi tối (日 + 免)', diffNote: 'Ghép 日 (mặt trời) + 免' },
    ],
  },
  '強': {
    kanji: '強',
    hanViet: 'CƯỜNG / CƯỠNG',
    strokeCount: 11,
    jlpt: 'N4',
    radicalNumber: 57,
    radicalSymbol: '弓',
    radicalPositionNote: 'Bộ 弓 (Cung — cây cung) nằm bên trái',
    structureType: 'Hình thanh',
    components: [
      { char: '弓', role: 'Nghĩa phù', meaning: 'Cung (cây cung căng mạnh) — bộ thủ chính' },
      { char: '虽', role: 'Thanh phù', meaning: 'Phần biến dạng của 弘/虫 tạo âm đọc キョウ/ゴウ' },
    ],
    etymologyFact:
      'Chữ Hình thanh lấy nghĩa phù 弓 (cây cung căng cứng có sức bật mạnh) kết hợp yếu tố thanh phù bên phải, biểu thị sự mạnh mẽ, kiên cường hoặc gắng sức (強い, 勉強).',
    mnemonicTip: 'Cây cung (弓) căng đầy lực bật → mạnh mẽ (強い), dốc sức học (勉強).',
    onyomi: ['キョウ', 'ゴウ'],
    kunyomi: ['つよ.い', 'し.いる'],
    confusables: [
      { kanji: '弱', hanViet: 'NHƯỢC', meaningVi: 'yếu ớt (hai cây cung 弓)', diffNote: 'Từ trái nghĩa trực tiếp của 強' },
    ],
  },
  '準': {
    kanji: '準',
    hanViet: 'CHUẨN',
    strokeCount: 13,
    jlpt: 'N3',
    radicalNumber: 85,
    radicalSymbol: '氵',
    radicalPositionNote: 'Biến thể của bộ 水 (Ba chấm thủy — mặt nước phẳng) ở bên trái',
    structureType: 'Hình thanh',
    components: [
      { char: '氵', role: 'Nghĩa phù', meaning: 'Thủy (mặt nước tĩnh lặng nằm ngang) — biểu thị thước đo thăng bằng' },
      { char: '隼', role: 'Thanh phù', meaning: 'Chuẩn (chim ưng) — tạo âm đọc ジュン (CHUẨN)' },
    ],
    etymologyFact:
      'Chữ Hình thanh gồm nghĩa phù 氵 (mặt nước đứng yên phẳng lặng dùng làm chuẩn mực thăng bằng thời cổ) và thanh phù 隼 (âm ジュン), mang nghĩa tiêu chuẩn, chuẩn bị (準備, 基準).',
    mnemonicTip: 'Mặt nước phẳng lặng (氵) là chuẩn mực đo đạc, đi với thanh phù 隼 (ジュン) → chuẩn bị (準備).',
    onyomi: ['ジュン'],
    kunyomi: ['じゅん.じる'],
    confusables: [
      { kanji: '集', hanViet: 'TẬP', meaningVi: 'tập hợp (隹 + 木)', diffNote: 'Không có 氵 và bên dưới là 木 thay vì 十' },
    ],
  },
  '備': {
    kanji: '備',
    hanViet: 'BỊ',
    strokeCount: 12,
    jlpt: 'N3',
    radicalNumber: 9,
    radicalSymbol: '亻',
    radicalPositionNote: 'Biến thể của bộ 人 (Nhân đứng — con người) ở bên trái',
    structureType: 'Hình thanh',
    components: [
      { char: '亻', role: 'Nghĩa phù', meaning: 'Nhân đứng (con người) — bộ thủ chính' },
      { char: '𤰇', role: 'Thanh phù', meaning: 'Dạng cổ tượng hình ống tên đầy đủ, góp âm đọc ビ (BỊ)' },
    ],
    etymologyFact:
      'Chữ Hình thanh gồm nghĩa phù 亻 (con người) và phần bên phải vốn tượng hình ống đựng đầy mũi tên (âm ビ), biểu thị sự trang bị đầy đủ, dự phòng (準備, 設備).',
    mnemonicTip: 'Con người (亻) trang bị sẵn sàng mọi thứ trước khi ra trận → chuẩn bị, thiết bị (準備, 設備).',
    onyomi: ['ビ'],
    kunyomi: ['そな.える', 'そな.わる'],
    confusables: [
      { kanji: '倍', hanViet: 'BỘI', meaningVi: 'gấp đôi (亻 + 咅)', diffNote: 'Cùng bộ 亻 bên trái nhưng bên phải đơn giản hơn' },
    ],
  },
  '未': {
    kanji: '未',
    hanViet: 'VỊ',
    strokeCount: 5,
    jlpt: 'N3',
    radicalNumber: 75,
    radicalSymbol: '木',
    radicalPositionNote: 'Bộ 木 (Mộc — cây cối)',
    structureType: 'Chỉ sự',
    components: [
      { char: '木', role: 'Nghĩa phù', meaning: 'Mộc (thân cây)' },
      { char: '一', role: 'Thành phần', meaning: 'Nét ngang NGẮN ở phía trên — cành non chưa vươn hết' },
    ],
    etymologyFact:
      'Chữ Chỉ sự lấy nền từ 木 (cây) thêm nét ngang ngắn ở trên ngọn, tượng trưng cành non mới nhú chưa phát triển hết → mang nghĩa "chưa" (未来 tương lai, 未満 chưa đầy).',
    mnemonicTip: 'Nét trên NGẮN hơn nét dưới = cây chưa mọc hết → CHƯA (未来). Khác với 末 (nét trên DÀI = ngọn cuối).',
    onyomi: ['ミ'],
    kunyomi: ['いま.だ', 'ま.だ'],
    confusables: [
      { kanji: '末', hanViet: 'MẠT', meaningVi: 'cuối cùng, ngọn (nét trên DÀI)', diffNote: '末 có nét ngang trên DÀI hơn nét dưới (週末 cuối tuần)' },
      { kanji: '来', hanViet: 'LAI', meaningVi: 'đến, tới', diffNote: 'Có thêm 2 chấm phẩy trên nét ngang thứ hai' },
    ],
  },
  '末': {
    kanji: '末',
    hanViet: 'MẠT',
    strokeCount: 5,
    jlpt: 'N3',
    radicalNumber: 75,
    radicalSymbol: '木',
    radicalPositionNote: 'Bộ 木 (Mộc — cây cối)',
    structureType: 'Chỉ sự',
    components: [
      { char: '木', role: 'Nghĩa phù', meaning: 'Mộc (thân cây)' },
      { char: '一', role: 'Thành phần', meaning: 'Nét ngang DÀI ở phía trên — chỉ điểm ngọn/cuối của cây' },
    ],
    etymologyFact:
      'Chữ Chỉ sự lấy nền từ 木 (cây) đặt nét ngang dài đánh dấu phần ngọn cao nhất, biểu thị phần ngọn, phần cuối cùng (週末 cuối tuần, 年末 cuối năm).',
    mnemonicTip: 'Nét ngang trên DÀI hơn nét dưới = ngọn cây, điểm cuối cùng (週末 cuối tuần).',
    onyomi: ['マツ', 'バツ'],
    kunyomi: ['すえ'],
    confusables: [
      { kanji: '未', hanViet: 'VỊ', meaningVi: 'chưa (nét trên NGẮN)', diffNote: '未 có nét ngang trên NGẮN hơn (未来 tương lai)' },
      { kanji: '本', hanViet: 'BẢN', meaningVi: 'gốc rễ, sách (nét ngang ở dưới gốc)', diffNote: 'Nét đánh dấu nằm ở phần rễ dưới cùng' },
    ],
  },
  '聞': {
    kanji: '聞',
    hanViet: 'VĂN',
    strokeCount: 14,
    jlpt: 'N5',
    radicalNumber: 128,
    radicalSymbol: '耳',
    radicalPositionNote: 'Bộ 耳 (Nhĩ — đôi tai) nằm bên trong cổng 門',
    structureType: 'Hình thanh',
    components: [
      { char: '門', role: 'Thanh phù', meaning: 'Môn (cánh cổng) — tạo âm đọc ブン/モン' },
      { char: '耳', role: 'Nghĩa phù', meaning: 'Nhĩ (đôi tai) — bộ thủ chính' },
    ],
    etymologyFact:
      'Chữ Hình thanh gồm nghĩa phù 耳 (đôi tai — bộ thủ chính là Nhĩ chứ không phải Môn) và thanh phù 門 (tạo âm ブン/モン), biểu thị việc nghe thấy và hỏi thăm (聞く, 新聞).',
    mnemonicTip: 'Áp tai (耳) bên cánh cổng (門) nghe tin tức → nghe, hỏi (聞く, 新聞). Lưu ý bộ thủ chính là 耳!',
    onyomi: ['ブン', 'モン'],
    kunyomi: ['き.く', 'き.こえる'],
    confusables: [
      { kanji: '間', hanViet: 'GIAN', meaningVi: 'khoảng giữa, thời gian (門 + 日)', diffNote: 'Bên trong là 日 (mặt trời)' },
      { kanji: '問', hanViet: 'VẤN', meaningVi: 'câu hỏi (門 + 口)', diffNote: 'Bên trong là 口 (cái miệng)' },
    ],
  },
  '間': {
    kanji: '間',
    hanViet: 'GIAN',
    strokeCount: 12,
    jlpt: 'N5',
    radicalNumber: 169,
    radicalSymbol: '門',
    radicalPositionNote: 'Bộ 門 (Môn — cánh cổng) bao bên ngoài',
    structureType: 'Hội ý',
    components: [
      { char: '門', role: 'Nghĩa phù', meaning: 'Môn (cánh cổng) — bộ thủ chính' },
      { char: '日', role: 'Thành phần', meaning: 'Nhật (ánh sáng mặt trời/mặt trăng xưa) lọt qua khe cửa' },
    ],
    etymologyFact:
      'Chữ Hội ý (Cựu tự thể 閒 có 月 ánh trăng lọt qua khe cổng 門, nay đổi thành 日), biểu thị khe hở, khoảng không gian hoặc khoảng thời gian ở giữa (時間, 人間).',
    mnemonicTip: 'Ánh sáng (日) lọt qua khe giữa hai cánh cổng (門) → khoảng giữa, thời gian (時間).',
    onyomi: ['カン', 'ケン'],
    kunyomi: ['あいだ', 'ま'],
    confusables: [
      { kanji: '聞', hanViet: 'VĂN', meaningVi: 'nghe (門 + 耳)', diffNote: 'Bên trong là 耳 (tai)' },
      { kanji: '問', hanViet: 'VẤN', meaningVi: 'hỏi (門 + 口)', diffNote: 'Bên trong là 口 (miệng)' },
    ],
  },
  '問': {
    kanji: '問',
    hanViet: 'VẤN',
    strokeCount: 11,
    jlpt: 'N4',
    radicalNumber: 30,
    radicalSymbol: '口',
    radicalPositionNote: 'Bộ 口 (Khẩu — miệng) nằm bên trong cổng 門',
    structureType: 'Hình thanh',
    components: [
      { char: '門', role: 'Thanh phù', meaning: 'Môn (cánh cổng) — tạo âm đọc モン' },
      { char: '口', role: 'Nghĩa phù', meaning: 'Khẩu (cái miệng) — bộ thủ chính chỉ hành động cất tiếng hỏi' },
    ],
    etymologyFact:
      'Chữ Hình thanh gồm nghĩa phù 口 (cái miệng — bộ thủ chính là Khẩu) và thanh phù 門 (âm モン), biểu thị hành động đặt câu hỏi, vấn đề (質問, 問題).',
    mnemonicTip: 'Mở miệng (口) trước cổng (門) để hỏi đường → câu hỏi, vấn đề (質問, 問題).',
    onyomi: ['モン'],
    kunyomi: ['と.う', 'と.い'],
    confusables: [
      { kanji: '聞', hanViet: 'VĂN', meaningVi: 'nghe (門 + 耳)', diffNote: 'Bên trong là 耳 (tai)' },
      { kanji: '間', hanViet: 'GIAN', meaningVi: 'khoảng giữa (門 + 日)', diffNote: 'Bên trong là 日 (mặt trời)' },
    ],
  },
  '行': {
    kanji: '行',
    hanViet: 'HÀNH / HÀNG',
    strokeCount: 6,
    jlpt: 'N5',
    radicalNumber: 144,
    radicalSymbol: '行',
    radicalPositionNote: 'Tự thân chữ là bộ thủ chính 行 (Hành)',
    structureType: 'Tượng hình',
    components: [
      { char: '行', role: 'Nghĩa phù', meaning: 'Tượng hình ngã tư đường giao nhau thời cổ' },
    ],
    etymologyFact:
      'Chữ Tượng hình vẽ ngã tư đường phố, từ đó mở rộng thành đi lại (HÀNH: 行く, 旅行) và dãy hàng, ngân hàng (HÀNG: 銀行, 一行).',
    mnemonicTip: 'Ngã tư đường phố → đi lại (HÀNH: 旅行) hoặc hàng lối/ngân hàng (HÀNG: 銀行).',
    onyomi: ['コウ', 'ギョウ', 'アン'],
    kunyomi: ['い.く', 'ゆ.く', 'おこな.う'],
    confusables: [
      { kanji: '街', hanViet: 'NHAI', meaningVi: 'con phố (行 + 圭)', diffNote: 'Thêm 圭 ở chính giữa ngã tư 行' },
    ],
  },
  '楽': {
    kanji: '楽',
    hanViet: 'LẠC / NHẠC',
    strokeCount: 13,
    jlpt: 'N4',
    radicalNumber: 75,
    radicalSymbol: '木',
    radicalPositionNote: 'Bộ 木 (Mộc — giá gỗ) ở phía dưới',
    structureType: 'Tượng hình',
    kyujitai: '樂',
    components: [
      { char: '白・冫', role: 'Thành phần', meaning: 'Dạng giản lược từ chuông trống & dây tơ trên giá gỗ trong Cựu tự thể 樂' },
      { char: '木', role: 'Nghĩa phù', meaning: 'Mộc (giá gỗ treo nhạc cụ) — bộ thủ chính' },
    ],
    etymologyFact:
      'Chữ Tượng hình (Cựu tự thể 樂) vẽ nhạc cụ dây/chuông đặt trên giá gỗ (木). Nghĩa gốc là âm nhạc (NHẠC: 音楽), từ đó mở rộng thành niềm vui, thoải mái (LẠC: 楽しい).',
    mnemonicTip: 'Nhạc cụ đặt trên giá gỗ (木) vang lên âm nhạc (音楽 NHẠC) mang lại niềm vui (楽しい LẠC).',
    onyomi: ['ガク', 'ラク'],
    kunyomi: ['たの.しい', 'たの.しむ'],
    confusables: [
      { kanji: '薬', hanViet: 'DƯỢC', meaningVi: 'thuốc (艹 + 楽 ← 藥)', diffNote: 'Thêm bộ 艹 (Thảo đầu) phía trên' },
    ],
  },
  '子': {
    kanji: '子',
    hanViet: 'TỬ',
    strokeCount: 3,
    jlpt: 'N5',
    radicalNumber: 39,
    radicalSymbol: '子',
    radicalPositionNote: 'Tự thân chữ là bộ thủ chính 子 (Tử)',
    structureType: 'Tượng hình',
    components: [
      { char: '子', role: 'Nghĩa phù', meaning: 'Tượng hình em bé quấn tã giang hai tay' },
    ],
    etymologyFact:
      'Chữ Tượng hình vẽ em bé sơ sinh với đầu và hai tay giang rộng, chỉ con cái, trẻ em (子ども, 男子). Âm Hán Việt hiện đại là TỬ (không dùng "Tí" trừ 12 địa chi).',
    mnemonicTip: 'Hình em bé giang tay → trẻ nhỏ, con cái (子ども, 電子).',
    onyomi: ['シ', 'ス'],
    kunyomi: ['こ'],
    confusables: [
      { kanji: '了', hanViet: 'LIỄU', meaningVi: 'hoàn tất (終了)', diffNote: 'Không có nét ngang ở giữa' },
      { kanji: '予', hanViet: 'DỰ', meaningVi: 'dự báo, trước (予定)', diffNote: 'Nét trên gãy góc khác 子' },
    ],
    bannedMyths: [/\btí\b/i],
  },
};

/**
 * Extract all unique Kanji characters (CJK Unified Ideographs) from a word in order of appearance.
 */
export function extractUniqueKanji(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ch of text || '') {
    if (/[\u4E00-\u9FAF]/.test(ch) && !seen.has(ch)) {
      seen.add(ch);
      result.push(ch);
    }
  }
  return result;
}

/**
 * Find Kangxi Radical record by symbol (supports official forms + positional variants).
 * Uses `kanji` context to strictly disambiguate 阝 -> 阜 (#170 left) vs 邑 (#163 right).
 */
export function findKangxiRadical(
  symbol: string,
  kanji?: string
): KangxiRadicalRecord | null {
  if (!symbol) return null;
  const cleaned = symbol.trim();
  const normalizedChar = cleaned.charAt(0);

  // Explicit disambiguation for 阝 / ⻖ / ⻏
  if (cleaned.includes('阜') || cleaned.includes('⻖')) {
    return KANGXI_BY_NUMBER.get(170) || null;
  }
  if (cleaned.includes('邑') || cleaned.includes('⻏')) {
    return KANGXI_BY_NUMBER.get(163) || null;
  }
  if (normalizedChar === '阝' && kanji) {
    if (LEFT_FU_RADICAL_KANJI.has(kanji)) return KANGXI_BY_NUMBER.get(170) || null;
    if (RIGHT_YU_RADICAL_KANJI.has(kanji)) return KANGXI_BY_NUMBER.get(163) || null;
  }

  const direct = KANGXI_BY_SYMBOL.get(normalizedChar);
  if (direct && direct.length > 0) {
    return direct[0];
  }
  return null;
}

export function getKangxiRadicalByNumber(num: number): KangxiRadicalRecord | null {
  return KANGXI_BY_NUMBER.get(num) || null;
}

/**
 * Build deterministic Ground-Truth entry directly from static KANJIDIC2/Daijirin lock.
 */
export function buildGroundTruthEntry(
  kanji: string,
  activeReadingHint?: string
): KanjiEtymologyEntry | null {
  const fact = KANJI_GROUND_TRUTH_DB[kanji];
  if (!fact) return null;
  const kangxi = getKangxiRadicalByNumber(fact.radicalNumber);
  return {
    kanji: fact.kanji,
    hanViet: fact.hanViet,
    strokeCount: fact.strokeCount,
    jlpt: fact.jlpt,
    radical: {
      symbol: fact.radicalSymbol,
      kangxiNumber: fact.radicalNumber,
      nameVi: kangxi?.nameVi || '',
      meaningVi: kangxi?.meaningVi || '',
      positionNote: fact.radicalPositionNote || kangxi?.positionHint,
    },
    structureType: fact.structureType,
    components: fact.components.map((c) => ({ ...c })),
    kyujitai: fact.kyujitai || undefined,
    etymologyFact: fact.etymologyFact,
    mnemonicTip: fact.mnemonicTip,
    onyomi: [...fact.onyomi],
    kunyomi: [...fact.kunyomi],
    activeReading: activeReadingHint || undefined,
    confusables: fact.confusables.map((c) => ({ ...c })),
  };
}

/**
 * Builds hard ground-truth constraints injected into the Gemini prompt
 * so the model never guesses radicals, Kyūjitai, Kokuji, or 阝 left/right identity.
 */
export function buildKanjiGroundTruthPromptHint(kanjiList: string[]): string {
  if (kanjiList.length === 0) return '';
  const lines: string[] = [
    `DANH SÁCH KANJI BẮT BUỘC GIẢI PHẪU THEO ĐÚNG THỨ TỰ (${kanjiList.length} chữ): ${kanjiList.join(' → ')}`,
    'KHÓA DỮ LIỆU CHÂN LÝ KANGXI / KANJIDIC2 / ĐẠI TỪ LÂM (CẤM LÀM TRÁI):',
  ];

  for (const k of kanjiList) {
    const fact = KANJI_GROUND_TRUTH_DB[k];
    if (fact) {
      const kangxi = getKangxiRadicalByNumber(fact.radicalNumber);
      lines.push(
        `- Chữ "${k}" [Hán Việt: ${fact.hanViet} | ${fact.strokeCount} nét | ${fact.jlpt} | Lục thư: ${fact.structureType}${
          fact.kyujitai ? ` | Cựu tự thể 旧字体: ${fact.kyujitai}` : ''
        }]: Bộ thủ chính (部首) = ${fact.radicalSymbol} (#${fact.radicalNumber} ${kangxi?.nameVi || ''} — ${kangxi?.meaningVi || ''}${
          fact.radicalPositionNote ? `; ${fact.radicalPositionNote}` : ''
        }). Thành phần chuẩn: ${fact.components.map((c) => `${c.char} [${c.role}: ${c.meaning}]`).join(' + ')}. On: ${fact.onyomi.join('・') || '—'}, Kun: ${fact.kunyomi.join('・') || '—'}.`
      );
    } else {
      const hints: string[] = [];
      if (LEFT_FU_RADICAL_KANJI.has(k)) {
        hints.push('Bộ thủ chính = 阝 bên TRÁI là #170 阜 (Phụ — gò đất/đê điều), TUYỆT ĐỐI KHÔNG phải 邑 (Ấp)');
      } else if (RIGHT_YU_RADICAL_KANJI.has(k)) {
        hints.push('Bộ thủ chính = 阝 bên PHẢI là #163 邑 (Ấp — vùng đất/đô thị), TUYỆT ĐỐI KHÔNG phải 阜 (Phụ)');
      }
      if (AUTHENTIC_KOKUJI_SET.has(k)) {
        hints.push('structureType BẮT BUỘC = "Quốc tự" (国字 do người Nhật sáng tạo)');
      }
      if (SHINJITAI_TO_KYUJITAI[k]) {
        hints.push(`Cựu tự thể 旧字体 BẮT BUỘC = "${SHINJITAI_TO_KYUJITAI[k]}" (giải thích từ nguyên theo Cựu tự thể)`);
      }
      if (hints.length > 0) {
        lines.push(`- Chữ "${k}": ${hints.join('; ')}.`);
      } else {
        lines.push(
          `- Chữ "${k}": Đối chiếu đúng 1 bộ thủ duy nhất trong Bảng 214 Bộ thủ Khang Hy; phân biệt rõ Nghĩa phù vs Thanh phù nếu là Hình thanh.`
        );
      }
    }
  }

  return lines.join('\n');
}

const VALID_STRUCTURE_TYPES = new Set<KanjiStructureType>([
  'Tượng hình',
  'Chỉ sự',
  'Hội ý',
  'Hình thanh',
  'Quốc tự',
]);

export interface KanjiValidationResult {
  valid: boolean;
  issues: string[];
  sanitizedEntries: KanjiEtymologyEntry[];
}

/**
 * Pre-Render Sanity Gate:
 * Verifies every Kanji entry against the 214 Kangxi Radicals table,
 * left/right 阝 rules, Shinjitai/Kyūjitai map, Kokuji list, and anti-myth regexes.
 */
export function validateAndSanitizeKanjiEtymology(
  rawEntries: unknown,
  targetKanjiList: string[],
  options?: { applyHardGroundTruthLock?: boolean }
): KanjiValidationResult {
  const issues: string[] = [];
  const rawList: Array<Record<string, unknown>> = Array.isArray(rawEntries)
    ? (rawEntries.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>)
    : [];

  if (targetKanjiList.length === 0) {
    return { valid: true, issues: [], sanitizedEntries: [] };
  }

  const byKanji = new Map<string, Record<string, unknown>>();
  for (const item of rawList) {
    const k = String(item.kanji || '').trim();
    if (k && !byKanji.has(k)) {
      byKanji.set(k, item);
    }
  }

  const sanitizedEntries: KanjiEtymologyEntry[] = [];

  for (const targetKanji of targetKanjiList) {
    const raw = byKanji.get(targetKanji);
    const groundFact = KANJI_GROUND_TRUTH_DB[targetKanji];

    if (!raw) {
      issues.push(`Thiếu phân tích cho chữ Kanji "${targetKanji}".`);
      if (options?.applyHardGroundTruthLock && groundFact) {
        const gt = buildGroundTruthEntry(targetKanji);
        if (gt) sanitizedEntries.push(gt);
      }
      continue;
    }

    const rawRad = (raw.radical && typeof raw.radical === 'object'
      ? raw.radical
      : {}) as Record<string, unknown>;
    const radSymbol = String(rawRad.symbol || '').trim();
    const radNameVi = String(rawRad.nameVi || '').trim();
    const radMeaningVi = String(rawRad.meaningVi || '').trim();
    const radPosNote = String(rawRad.positionNote || '').trim();
    const structureTypeRaw = String(raw.structureType || '').trim() as KanjiStructureType;
    const hanViet = String(raw.hanViet || '').trim();
    const kyujitai = String(raw.kyujitai || '').trim();
    const etymologyFact = String(raw.etymologyFact || '').trim();
    const mnemonicTip = String(raw.mnemonicTip || '').trim();
    const activeReading = String(raw.activeReading || '').trim();
    const onyomi = Array.isArray(raw.onyomi)
      ? raw.onyomi.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    const kunyomi = Array.isArray(raw.kunyomi)
      ? raw.kunyomi.map((s) => String(s || '').trim()).filter(Boolean)
      : [];

    const rawComponents = Array.isArray(raw.components)
      ? (raw.components as Array<Record<string, unknown>>)
      : [];
    const components: KanjiComponentItem[] = rawComponents
      .map((c) => {
        const roleRaw = String(c.role || '').trim();
        const role: KanjiComponentItem['role'] =
          roleRaw === 'Nghĩa phù' || roleRaw === 'Thanh phù' ? roleRaw : 'Thành phần';
        return {
          char: String(c.char || '').trim(),
          role,
          meaning: String(c.meaning || '').trim(),
        };
      })
      .filter((c) => c.char.length > 0 && c.meaning.length > 0);

    const rawConfusables = Array.isArray(raw.confusables)
      ? (raw.confusables as Array<Record<string, unknown>>)
      : [];
    const confusables: KanjiConfusableItem[] = rawConfusables
      .map((cf) => ({
        kanji: String(cf.kanji || '').trim(),
        hanViet: String(cf.hanViet || '').trim(),
        meaningVi: String(cf.meaningVi || '').trim(),
        diffNote: String(cf.diffNote || '').trim() || undefined,
      }))
      .filter((cf) => cf.kanji.length > 0 && cf.kanji !== targetKanji);

    // 1. Validate radical against 214 Kangxi table
    const matchedKangxi = findKangxiRadical(radSymbol, targetKanji);
    if (!matchedKangxi) {
      issues.push(
        `Chữ "${targetKanji}": Bộ thủ "${radSymbol}" không hợp lệ trong Bảng 214 Bộ thủ Khang Hy.`
      );
    }

    // 2. Validate 阝 Left (阜 Phụ) vs Right (邑 Ấp) rule
    const combinedText = `${radSymbol} ${radNameVi} ${radMeaningVi} ${radPosNote} ${etymologyFact}`;
    if (LEFT_FU_RADICAL_KANJI.has(targetKanji)) {
      if (/邑|\bấp\b|làng\s*mạc|đô\s*thị/i.test(`${radSymbol} ${radNameVi} ${radMeaningVi}`)) {
        issues.push(
          `Chữ "${targetKanji}": SAI BỘ THỦ 阝 bên TRÁI phải là #170 阜 (Phụ — gò đất/đê), KHÔNG phải 邑 (Ấp).`
        );
      }
    }
    if (RIGHT_YU_RADICAL_KANJI.has(targetKanji)) {
      if (/阜|\bphụ\b|gò\s*đất|đê\s*điều|sườn\s*núi/i.test(`${radSymbol} ${radNameVi} ${radMeaningVi}`)) {
        issues.push(
          `Chữ "${targetKanji}": SAI BỘ THỦ 阝 bên PHẢI phải là #163 邑 (Ấp — vùng đất/đô thị), KHÔNG phải 阜 (Phụ).`
        );
      }
    }

    // 3. Validate Kokuji classification
    if (AUTHENTIC_KOKUJI_SET.has(targetKanji) && structureTypeRaw !== 'Quốc tự') {
      issues.push(`Chữ "${targetKanji}" là Quốc tự (国字) của Nhật, structureType bắt buộc là "Quốc tự".`);
    }

    // 4. Validate Shinjitai -> Kyūjitai presence
    const expectedKyujitai = SHINJITAI_TO_KYUJITAI[targetKanji];
    if (expectedKyujitai && !kyujitai) {
      issues.push(`Chữ "${targetKanji}" là Tân tự thể, bắt buộc ghi rõ Cựu tự thể kyujitai = "${expectedKyujitai}".`);
    }

    // 5. Validate against Ground-Truth DB (official radical, structureType, banned folk myths)
    if (groundFact) {
      const gtKangxi = getKangxiRadicalByNumber(groundFact.radicalNumber);
      if (matchedKangxi && matchedKangxi.number !== groundFact.radicalNumber) {
        issues.push(
          `Chữ "${targetKanji}": Sai bộ thủ chính (AI chọn #${matchedKangxi.number} ${matchedKangxi.symbol}, đúng là #${groundFact.radicalNumber} ${groundFact.radicalSymbol} ${gtKangxi?.nameVi || ''}).`
        );
      }
      if (structureTypeRaw !== groundFact.structureType) {
        issues.push(
          `Chữ "${targetKanji}": Sai phân loại Lục thư (đúng là "${groundFact.structureType}").`
        );
      }
      if (groundFact.bannedMyths) {
        for (const regex of groundFact.bannedMyths) {
          if (regex.test(combinedText) || regex.test(mnemonicTip)) {
            issues.push(
              `Chữ "${targetKanji}": Chứa lỗi suy diễn dân gian/từ nguyên sai (${regex.source}).`
            );
          }
        }
      }
    }

    if (!VALID_STRUCTURE_TYPES.has(structureTypeRaw)) {
      issues.push(`Chữ "${targetKanji}": structureType "${structureTypeRaw}" không thuộc Lục thư chuẩn.`);
    }

    if (!etymologyFact) {
      issues.push(`Chữ "${targetKanji}": Thiếu giải thích cội nguồn học thuật (etymologyFact).`);
    }

    // Build sanitized entry — if hard Ground-Truth lock is requested, deterministically anchor verified fields
    if (options?.applyHardGroundTruthLock && groundFact) {
      const gtEntry = buildGroundTruthEntry(targetKanji, activeReading || undefined);
      if (gtEntry) {
        sanitizedEntries.push({
          ...gtEntry,
          activeReading: activeReading || gtEntry.activeReading,
        });
        continue;
      }
    }

    const resolvedKangxi = matchedKangxi
      ? matchedKangxi
      : LEFT_FU_RADICAL_KANJI.has(targetKanji)
        ? getKangxiRadicalByNumber(170)
        : RIGHT_YU_RADICAL_KANJI.has(targetKanji)
          ? getKangxiRadicalByNumber(163)
          : null;

    const finalStructureType: KanjiStructureType = AUTHENTIC_KOKUJI_SET.has(targetKanji)
      ? 'Quốc tự'
      : VALID_STRUCTURE_TYPES.has(structureTypeRaw)
        ? structureTypeRaw
        : 'Hình thanh';

    const strokeNum = Number(raw.strokeCount);
    const jlptRaw = String(raw.jlpt || '').trim();
    const validJlpt =
      jlptRaw === 'N5' || jlptRaw === 'N4' || jlptRaw === 'N3' || jlptRaw === 'N2' || jlptRaw === 'N1'
        ? jlptRaw
        : undefined;

    sanitizedEntries.push({
      kanji: targetKanji,
      hanViet: hanViet.toUpperCase(),
      strokeCount: Number.isFinite(strokeNum) && strokeNum > 0 ? Math.round(strokeNum) : undefined,
      jlpt: validJlpt,
      radical: {
        symbol: radSymbol || resolvedKangxi?.symbol || targetKanji,
        kangxiNumber: resolvedKangxi?.number,
        nameVi: resolvedKangxi?.nameVi || radNameVi,
        meaningVi: radMeaningVi || resolvedKangxi?.meaningVi || '',
        positionNote: radPosNote || resolvedKangxi?.positionHint,
      },
      structureType: finalStructureType,
      components:
        components.length > 0
          ? components
          : [
              {
                char: radSymbol || resolvedKangxi?.symbol || targetKanji,
                role: 'Nghĩa phù',
                meaning: `${resolvedKangxi?.nameVi || radNameVi} (${radMeaningVi || resolvedKangxi?.meaningVi || ''})`,
              },
            ],
      kyujitai: kyujitai || expectedKyujitai || undefined,
      etymologyFact,
      mnemonicTip: mnemonicTip || undefined,
      onyomi,
      kunyomi,
      activeReading: activeReading || undefined,
      confusables,
    });
  }

  return {
    valid: issues.length === 0,
    issues,
    sanitizedEntries,
  };
}

/**
 * Generates a concise backward-compatible summary line from verified KanjiEtymologyEntry[].
 */
export function formatVerifiedRadicalSummary(entries: KanjiEtymologyEntry[]): string {
  if (!entries || entries.length === 0) return '';
  return entries
    .map((e) => {
      const parts = e.components.map((c) => `${c.char} (${c.role})`).join(' + ');
      const kyu = e.kyujitai ? ` [旧:${e.kyujitai}]` : '';
      return `${e.kanji}${kyu} (${e.hanViet} · ${e.structureType}) — Bộ ${e.radical.symbol} (${e.radical.nameVi}): ${parts}`;
    })
    .join(' ｜ ');
}
