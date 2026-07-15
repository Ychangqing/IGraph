package com.demo.service;

import java.util.List;
import com.demo.model.User;

public class UserService extends BaseService implements Repository {
    public int total;
    private String secret;

    public User findUser(String id) {
        return loadUser(id);
    }

    private User loadUser(String id) {
        return new User();
    }
}

class InternalHelper {
    void doWork() {
        System.out.println("work");
    }
}