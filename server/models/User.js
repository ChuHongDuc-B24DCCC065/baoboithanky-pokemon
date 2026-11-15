const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: [true, "Tên đăng nhập không được để trống"],
            unique: true,
            trim: true,
            lowercase: true,
            minlength: [3, "Tên đăng nhập phải có ít nhất 3 ký tự"],
            maxlength: [20, "Tên đăng nhập không được vượt quá 20 ký tự"],
            match: [
                /^[a-zA-Z0-9_]+$/,
                "Tên đăng nhập chỉ được chứa chữ cái, chữ số và dấu gạch dưới (_)"
            ],
            index: true
        },
        password: {
            type: String,
            required: [true, "Mật khẩu không được để trống"],
            minlength: [6, "Mật khẩu phải có ít nhất 6 ký tự"],
            select: false
        },
        character: {
            type: String,
            default: "red",
            enum: {
                values: [
                    "red",
                    "leaf",
                    "brendan",
                    "ethan",
                    "kris",
                    "lucas",
                    "dawn",
                    "blue",
                    "silver"
                ],
                message: "Nhân vật '{VALUE}' không hợp lệ trong danh mục nhân vật của trò chơi"
            }
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true,
        toJSON: {
            transform: function (doc, ret) {
                delete ret.password;
                delete ret.__v;
                return ret;
            }
        },
        toObject: {
            transform: function (doc, ret) {
                delete ret.password;
                delete ret.__v;
                return ret;
            }
        }
    }
);

// Asynchronous Mongoose pre-save hook (Không sử dụng callback next() với async)
UserSchema.pre("save", async function () {
    if (!this.isModified("password")) return;

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

/**
 * Kiểm tra so khớp mật khẩu ứng viên với mật khẩu đã băm
 * @param {string} candidatePassword - Mật khẩu người dùng nhập vào
 * @returns {Promise<boolean>} Kết quả so khớp
 */
UserSchema.methods.comparePassword = async function (candidatePassword) {
    if (!candidatePassword || typeof candidatePassword !== "string") {
        return false;
    }
    if (!this.password) {
        return false;
    }
    return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.models.User || mongoose.model("User", UserSchema);
