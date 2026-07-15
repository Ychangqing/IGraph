package service

import (
	"fmt"
	rnd "math/rand"
)

// MaxRetries 是导出常量（首字母大写）
const MaxRetries = 3

// internalSeed 是包内私有变量（首字母小写）
var internalSeed = 42

// Repository 是导出接口（首字母大写 → 导出）
type Repository interface {
	Find(id string) *User
}

// User 是导出结构体
type User struct {
	Name string
	age  int
}

// UserService 是导出结构体
type UserService struct {
	repo Repository
}

// FindUser 是导出方法（首字母大写），内部调用私有 loadUser
func (s *UserService) FindUser(id string) *User {
	return s.loadUser(id)
}

// loadUser 是包内私有方法（首字母小写）
func (s *UserService) loadUser(id string) *User {
	fmt.Println(id)
	return &User{}
}

// Exported 是导出函数，调用私有 helper 与包函数 rnd.Intn
func Exported() int {
	helper()
	return rnd.Intn(MaxRetries)
}

// helper 是包内私有函数
func helper() {}