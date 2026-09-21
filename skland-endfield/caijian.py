import tkinter as tk
from tkinter import filedialog, messagebox
from PIL import Image, ImageTk

class ImageCropper:
    def __init__(self, root):
        self.root = root
        self.root.title("图像裁剪工具 - 输出180x180像素")
        self.root.geometry("800x700")

        # 图像相关变量
        self.original_image = None      # PIL Image对象 (原图)
        self.display_image = None       # PIL Image对象 (显示用，可能缩放)
        self.tk_image = None            # 用于Canvas显示的ImageTk对象
        self.canvas = None
        self.canvas_image_id = None

        # 框选矩形相关
        self.start_x = None
        self.start_y = None
        self.rect_id = None
        self.crop_box = None            # (x1, y1, x2, y2) 原图坐标

        # 界面布局
        self.create_widgets()

    def create_widgets(self):
        # 顶部按钮框架
        top_frame = tk.Frame(self.root)
        top_frame.pack(pady=10)

        btn_open = tk.Button(top_frame, text="打开图片", command=self.load_image, width=12)
        btn_open.pack(side=tk.LEFT, padx=5)

        btn_save = tk.Button(top_frame, text="保存裁剪结果", command=self.save_cropped, width=12)
        btn_save.pack(side=tk.LEFT, padx=5)

        btn_reset = tk.Button(top_frame, text="清除选框", command=self.clear_rectangle, width=12)
        btn_reset.pack(side=tk.LEFT, padx=5)

        # 提示标签
        info_label = tk.Label(self.root, text="操作说明：用鼠标左键在图片上拖拽框选区域，释放后自动裁剪并缩放为180x180像素",
                              fg="blue")
        info_label.pack(pady=5)

        # 画布 (带滚动条，以应对较大图片)
        canvas_frame = tk.Frame(self.root)
        canvas_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        self.canvas = tk.Canvas(canvas_frame, bg='gray')
        h_scroll = tk.Scrollbar(canvas_frame, orient=tk.HORIZONTAL, command=self.canvas.xview)
        v_scroll = tk.Scrollbar(canvas_frame, orient=tk.VERTICAL, command=self.canvas.yview)
        self.canvas.configure(xscrollcommand=h_scroll.set, yscrollcommand=v_scroll.set)

        self.canvas.grid(row=0, column=0, sticky='nsew')
        h_scroll.grid(row=1, column=0, sticky='ew')
        v_scroll.grid(row=0, column=1, sticky='ns')

        canvas_frame.grid_rowconfigure(0, weight=1)
        canvas_frame.grid_columnconfigure(0, weight=1)

        # 绑定鼠标事件
        self.canvas.bind("<ButtonPress-1>", self.on_mouse_down)
        self.canvas.bind("<B1-Motion>", self.on_mouse_move)
        self.canvas.bind("<ButtonRelease-1>", self.on_mouse_up)

        # 状态栏
        self.status_var = tk.StringVar()
        self.status_var.set("就绪 | 请打开图片")
        status_bar = tk.Label(self.root, textvariable=self.status_var, bd=1, relief=tk.SUNKEN, anchor=tk.W)
        status_bar.pack(side=tk.BOTTOM, fill=tk.X)

    def load_image(self):
        """打开文件对话框，加载图片"""
        file_path = filedialog.askopenfilename(
            title="选择图片",
            filetypes=[("图像文件", "*.jpg *.jpeg *.png *.bmp *.tiff"), ("所有文件", "*.*")]
        )
        if not file_path:
            return
        try:
            # 打开并转为RGB模式（避免PNG透明通道问题）
            img = Image.open(file_path).convert("RGB")
            # 可选：检查图片尺寸是否符合预期，但不强制
            self.original_image = img
            self.display_image = img.copy()
            self.update_canvas_image()
            self.status_var.set(f"已加载图片: {img.size[0]}x{img.size[1]} 像素")
            self.clear_rectangle()  # 清除之前的选框
        except Exception as e:
            messagebox.showerror("错误", f"无法加载图片:\n{e}")

    def update_canvas_image(self):
        """将当前显示图像绘制到Canvas上，并重置画布滚动区域"""
        if self.display_image is None:
            return
        self.tk_image = ImageTk.PhotoImage(self.display_image)
        if self.canvas_image_id:
            self.canvas.delete(self.canvas_image_id)
        self.canvas_image_id = self.canvas.create_image(0, 0, anchor=tk.NW, image=self.tk_image)
        self.canvas.config(scrollregion=self.canvas.bbox(tk.ALL))

    def on_mouse_down(self, event):
        """鼠标按下：记录起始点（相对于画布，但画布坐标与图片像素坐标一致因为图片无缩放）"""
        if self.original_image is None:
            return
        # 获取画布上的实际坐标（考虑滚动条）
        x = self.canvas.canvasx(event.x)
        y = self.canvas.canvasy(event.y)
        self.start_x = int(x)
        self.start_y = int(y)
        # 删除之前的临时矩形
        if self.rect_id:
            self.canvas.delete(self.rect_id)
            self.rect_id = None

    def on_mouse_move(self, event):
        """鼠标拖动：绘制矩形框"""
        if self.start_x is None or self.original_image is None:
            return
        cur_x = int(self.canvas.canvasx(event.x))
        cur_y = int(self.canvas.canvasy(event.y))
        # 删除旧的矩形框，绘制新的
        if self.rect_id:
            self.canvas.delete(self.rect_id)
        self.rect_id = self.canvas.create_rectangle(
            self.start_x, self.start_y, cur_x, cur_y,
            outline='red', width=2
        )

    def on_mouse_up(self, event):
        """鼠标释放：确定矩形区域，执行裁剪并缩放"""
        if self.start_x is None or self.original_image is None:
            return
        end_x = int(self.canvas.canvasx(event.x))
        end_y = int(self.canvas.canvasy(event.y))

        # 确保矩形坐标有序 (x1<=x2, y1<=y2)
        x1 = min(self.start_x, end_x)
        y1 = min(self.start_y, end_y)
        x2 = max(self.start_x, end_x)
        y2 = max(self.start_y, end_y)

        # 边界检查，不能超出图片范围
        img_w, img_h = self.original_image.size
        x1 = max(0, min(x1, img_w-1))
        y1 = max(0, min(y1, img_h-1))
        x2 = max(0, min(x2, img_w))
        y2 = max(0, min(y2, img_h))

        if x2 <= x1 or y2 <= y1:
            self.status_var.set("选框无效（宽度或高度为0）")
            return

        self.crop_box = (x1, y1, x2, y2)
        # 执行裁剪并缩放
        self.crop_and_resize()

        # 清除起始点，但保留矩形框显示 (可保留)
        self.start_x = None
        self.start_y = None
        # 更新状态
        self.status_var.set(f"已裁剪区域: ({x1},{y1}) -> ({x2},{y2}) ，并缩放至180x180像素")

    def crop_and_resize(self):
        """根据self.crop_box裁剪原图，并缩放至180x180，显示预览"""
        if self.original_image is None or self.crop_box is None:
            return
        x1, y1, x2, y2 = self.crop_box
        # 裁剪
        cropped = self.original_image.crop((x1, y1, x2, y2))
        # 缩放至180x180 (强制尺寸，不保持比例)
        resized = cropped.resize((180, 180), Image.Resampling.LANCZOS)
        self.result_image = resized  # 保存结果供保存用
        # 在新窗口预览结果
        self.show_preview(resized)

    def show_preview(self, img):
        """在新窗口中显示预览图像"""
        preview_win = tk.Toplevel(self.root)
        preview_win.title("裁剪结果 (180x180像素)")
        preview_win.geometry("300x300")
        # 转换为ImageTk
        preview_tk = ImageTk.PhotoImage(img)
        label = tk.Label(preview_win, image=preview_tk)
        label.image = preview_tk  # 保持引用
        label.pack(pady=20)
        tk.Button(preview_win, text="保存此图像", command=lambda: self.save_specific(img)).pack(pady=10)

    def save_specific(self, img):
        """保存指定的PIL图像"""
        file_path = filedialog.asksaveasfilename(
            defaultextension=".png",
            filetypes=[("PNG文件", "*.png"), ("JPEG文件", "*.jpg"), ("所有文件", "*.*")]
        )
        if file_path:
            try:
                img.save(file_path)
                messagebox.showinfo("成功", f"图像已保存至:\n{file_path}")
            except Exception as e:
                messagebox.showerror("错误", f"保存失败:\n{e}")

    def save_cropped(self):
        """保存最后一次裁剪并缩放后的图像"""
        if hasattr(self, 'result_image') and self.result_image:
            self.save_specific(self.result_image)
        else:
            messagebox.showwarning("无结果", "还没有裁剪结果，请先在图片上框选区域。")

    def clear_rectangle(self):
        """清除画布上的矩形框和缓存的选择框"""
        if self.rect_id:
            self.canvas.delete(self.rect_id)
            self.rect_id = None
        self.crop_box = None
        self.start_x = None
        self.start_y = None
        self.status_var.set("已清除选框")

def main():
    root = tk.Tk()
    app = ImageCropper(root)
    root.mainloop()

if __name__ == "__main__":
    main()